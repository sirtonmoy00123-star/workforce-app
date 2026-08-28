// POST /api/attendance/checkout — Employee attendance check-out
//
// Accepts multipart/form-data:
//   shiftId       — required
//   qrToken       — the scanned QR string (if checkout method requires QR)
//   latitude      — GPS lat  (if checkout method requires GPS)
//   longitude     — GPS lng  (if checkout method requires GPS)
//   selfie        — File     (if checkout method requires selfie)
//   auto          — "true" for BUTTON_ONLY auto-checkout
//
// Updates attendance_record checkout fields + creates exceptions.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, handleTenantError } from "@/lib/services/tenantContext";
import { validateDynamicQrToken } from "@/lib/services/dynamicQr";
import { haversineDistanceMetres } from "@/lib/calculations/geo";
import { notifyAdminException } from "@/lib/services/notificationService";
import { canCheckout, type ShiftState } from "@/lib/services/shiftStateMachine";
import { getWorkSession } from "@/lib/services/workSessionService";

export async function POST(request: Request) {
  try {
    const ctx = await requireMember();

    if (!ctx.employeeId) {
      return NextResponse.json({ error: "Only employees can check out." }, { status: 403 });
    }

    const formData = await request.formData();
    const shiftId = formData.get("shiftId") as string | null;
    const isAuto = formData.get("auto") === "true";

    if (!shiftId) {
      return NextResponse.json({ error: "shiftId is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // ── 1. Load the shift ────────────────────────────────────
    const { data: shift } = await adminClient
      .from("shifts")
      .select("id, business_id, employee_id, location_id, scheduled_start, scheduled_finish, status, date")
      .eq("id", shiftId)
      .eq("business_id", ctx.businessId)
      .single();

    if (!shift) {
      return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    }

    if (shift.employee_id !== ctx.employeeId) {
      return NextResponse.json({ error: "This shift is not assigned to you." }, { status: 403 });
    }

    // ── State machine guard ──
    const ws = await getWorkSession(adminClient, shiftId);
    const shiftState: ShiftState = {
      shiftStatus: shift.status,
      workSessionStatus: ws?.status || null,
      hasCheckedIn: true, // must have checked in to reach checkout
    };

    const guard = canCheckout(shiftState);
    if (!guard.allowed) {
      return NextResponse.json({ error: guard.reason }, { status: 400 });
    }

    // ── 2. Load existing attendance record ───────────────────
    const { data: record } = await adminClient
      .from("attendance_records")
      .select("*")
      .eq("shift_id", shiftId)
      .eq("business_id", ctx.businessId)
      .single();

    if (!record) {
      return NextResponse.json({ error: "No attendance record found. You must check in first." }, { status: 400 });
    }

    if (record.checkin_status === "NOT_CHECKED_IN") {
      return NextResponse.json({ error: "You must check in before checking out." }, { status: 400 });
    }

    if (record.checkout_status !== "NOT_CHECKED_OUT") {
      return NextResponse.json({ error: "You have already checked out." }, { status: 409 });
    }

    // ── 3. Load location + attendance settings ───────────────
    const [{ data: location }, { data: settings }] = await Promise.all([
      adminClient
        .from("work_locations")
        .select("id, name, latitude, longitude, status")
        .eq("id", shift.location_id!)
        .eq("business_id", ctx.businessId)
        .single(),
      adminClient
        .from("attendance_settings")
        .select("*")
        .eq("location_id", shift.location_id!)
        .eq("business_id", ctx.businessId)
        .single(),
    ]);

    if (!location || !settings) {
      return NextResponse.json({ error: "Location or attendance settings not found." }, { status: 400 });
    }

    const checkoutMethod = settings.checkout_method || "BUTTON_ONLY";

    // ── 4. QR verification (if required by checkout method) ──
    let qrVerifiedCheckout = false;

    if (checkoutMethod === "QR_GPS" || checkoutMethod === "QR_GPS_SELFIE") {
      const qrToken = formData.get("qrToken") as string | null;
      if (!qrToken && !isAuto) {
        return NextResponse.json({ error: "QR scan is required for checkout." }, { status: 400 });
      }

      if (qrToken) {
        const qrMode = (settings.qr_mode as "STATIC" | "DYNAMIC") || "STATIC";

        if (qrMode === "STATIC") {
          if (!qrToken.startsWith("WFA:CHECKIN:")) {
            return NextResponse.json({ error: "Invalid QR code format." }, { status: 400 });
          }
          const token = qrToken.slice("WFA:CHECKIN:".length);
          const { data: credential } = await adminClient
            .from("static_qr_credentials")
            .select("id, location_id, status")
            .eq("token", token)
            .eq("business_id", ctx.businessId)
            .single();

          if (!credential || credential.status !== "ACTIVE") {
            return NextResponse.json({ error: "QR code not recognised or inactive." }, { status: 400 });
          }
          if (credential.location_id !== shift.location_id) {
            return NextResponse.json({ error: "Wrong work location QR code." }, { status: 400 });
          }
          qrVerifiedCheckout = true;
        } else if (qrMode === "DYNAMIC") {
          const result = validateDynamicQrToken(qrToken);
          if (!result.valid) {
            return NextResponse.json({ error: result.error }, { status: 400 });
          }
          if (result.payload.bid !== ctx.businessId || result.payload.lid !== shift.location_id) {
            return NextResponse.json({ error: "QR code does not match this location." }, { status: 400 });
          }
          qrVerifiedCheckout = true;
        }
      }
    }

    // ── 5. GPS verification (if required by checkout method) ─
    let checkoutLat: number | null = null;
    let checkoutLng: number | null = null;
    let checkoutDistanceMetres: number | null = null;
    let gpsOutOfRange = false;

    if (checkoutMethod === "GPS_ONLY" || checkoutMethod === "QR_GPS" || checkoutMethod === "QR_GPS_SELFIE") {
      const latStr = formData.get("latitude") as string | null;
      const lngStr = formData.get("longitude") as string | null;

      if (!latStr || !lngStr) {
        if (!isAuto) {
          return NextResponse.json({ error: "GPS coordinates are required for checkout." }, { status: 400 });
        }
      } else {
        checkoutLat = parseFloat(latStr);
        checkoutLng = parseFloat(lngStr);
        if (isNaN(checkoutLat) || isNaN(checkoutLng)) {
          return NextResponse.json({ error: "Invalid GPS coordinates." }, { status: 400 });
        }

        if (location.latitude != null && location.longitude != null) {
          checkoutDistanceMetres = haversineDistanceMetres(
            checkoutLat, checkoutLng,
            location.latitude, location.longitude
          );
          const allowedRadius = settings.allowed_radius_metres ?? 100;
          gpsOutOfRange = checkoutDistanceMetres > allowedRadius;
        }
      }
    }

    // ── 6. Selfie upload (if required by checkout method) ────
    let checkoutSelfiePath: string | null = null;

    if (checkoutMethod === "QR_GPS_SELFIE") {
      const selfieFile = formData.get("selfie") as File | null;
      if (!selfieFile && !isAuto) {
        return NextResponse.json({ error: "A selfie is required for checkout." }, { status: 400 });
      }

      if (selfieFile) {
        const ext = selfieFile.name.split(".").pop() || "jpg";
        const path = `${ctx.employeeId}/${shiftId}/checkout_selfie_${Date.now()}.${ext}`;
        const buffer = Buffer.from(await selfieFile.arrayBuffer());
        const { error: uploadErr } = await adminClient.storage
          .from("attendance-photos")
          .upload(path, buffer, { contentType: selfieFile.type, upsert: false });
        if (uploadErr) {
          return NextResponse.json({ error: "Failed to upload selfie: " + uploadErr.message }, { status: 500 });
        }
        checkoutSelfiePath = path;
      }
    }

    // ── 7. Determine checkout status ─────────────────────────
    const now = new Date();
    const scheduledFinish = new Date(shift.scheduled_finish);
    const earlyThreshold = settings.early_departure_review_minutes ?? 10;
    const lateThreshold = settings.late_finish_review_minutes ?? 15;

    const minsEarly = Math.max(0, Math.floor((scheduledFinish.getTime() - now.getTime()) / 60_000));
    const minsLate = Math.max(0, Math.floor((now.getTime() - scheduledFinish.getTime()) / 60_000));

    type CheckoutStatus = "NOT_CHECKED_OUT" | "CHECKED_OUT" | "EARLY_DEPARTURE" | "LATE_DEPARTURE" | "NEEDS_REVIEW" | "AUTO_CHECKOUT";

    let checkoutStatus: CheckoutStatus;
    let requiresReview = record.requires_review || false;

    if (isAuto && checkoutMethod === "BUTTON_ONLY") {
      checkoutStatus = "AUTO_CHECKOUT";
    } else if (gpsOutOfRange) {
      checkoutStatus = "NEEDS_REVIEW";
      requiresReview = true;
    } else if (minsEarly > earlyThreshold) {
      checkoutStatus = "EARLY_DEPARTURE";
      requiresReview = true;
    } else if (minsLate > lateThreshold) {
      checkoutStatus = "LATE_DEPARTURE";
      requiresReview = true;
    } else {
      checkoutStatus = "CHECKED_OUT";
    }

    // ── 8. Update attendance record ──────────────────────────
    const updateData: {
      actual_checkout: string;
      checkout_status: CheckoutStatus;
      checkout_latitude: number | null;
      checkout_longitude: number | null;
      checkout_distance_metres: number | null;
      checkout_selfie_path: string | null;
      checkout_qr_verified: boolean;
      requires_review: boolean;
      verification_status?: "PENDING" | "NEEDS_REVIEW" | "VERIFIED" | "REJECTED";
    } = {
      actual_checkout: now.toISOString(),
      checkout_status: checkoutStatus,
      checkout_latitude: checkoutLat,
      checkout_longitude: checkoutLng,
      checkout_distance_metres: checkoutDistanceMetres,
      checkout_selfie_path: checkoutSelfiePath,
      checkout_qr_verified: qrVerifiedCheckout,
      requires_review: requiresReview,
    };

    // If checkout creates a review need, set verification to NEEDS_REVIEW
    if (requiresReview && record.verification_status === "VERIFIED") {
      updateData.verification_status = "NEEDS_REVIEW";
    } else if (requiresReview && record.verification_status !== "NEEDS_REVIEW") {
      updateData.verification_status = "NEEDS_REVIEW";
    } else if (!requiresReview && !record.requires_review && checkoutStatus === "CHECKED_OUT") {
      // Clean checkout + clean check-in → auto-verify the whole record
      updateData.verification_status = "VERIFIED";
    }

    // Cast to any because checkout_selfie_path and checkout_qr_verified
    // are not in the generated Supabase types yet (added in migration 017)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updatedRecord, error: updateError } = await (adminClient as any)
      .from("attendance_records")
      .update(updateData)
      .eq("id", record.id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // ── 9. Create exceptions ─────────────────────────────────
    type ExceptionType = "LATE_ARRIVAL" | "EARLY_ARRIVAL" | "EARLY_DEPARTURE" | "LATE_DEPARTURE" | "GPS_OUT_OF_RANGE" | "QR_MISMATCH" | "MISSING_SELFIE" | "MISSING_SITE_PHOTO";

    const exceptions: Array<{
      business_id: string;
      attendance_record_id: string;
      employee_id: string;
      shift_id: string;
      exception_type: ExceptionType;
      difference_minutes?: number;
      difference_metres?: number;
      status: "PENDING";
    }> = [];

    if (minsEarly > earlyThreshold) {
      exceptions.push({
        business_id: ctx.businessId,
        attendance_record_id: record.id,
        employee_id: ctx.employeeId,
        shift_id: shiftId,
        exception_type: "EARLY_DEPARTURE" as const,
        difference_minutes: minsEarly,
        status: "PENDING" as const,
      });
    }

    if (minsLate > lateThreshold) {
      exceptions.push({
        business_id: ctx.businessId,
        attendance_record_id: record.id,
        employee_id: ctx.employeeId,
        shift_id: shiftId,
        exception_type: "LATE_DEPARTURE" as const,
        difference_minutes: minsLate,
        status: "PENDING" as const,
      });
    }

    if (gpsOutOfRange && checkoutDistanceMetres != null) {
      exceptions.push({
        business_id: ctx.businessId,
        attendance_record_id: record.id,
        employee_id: ctx.employeeId,
        shift_id: shiftId,
        exception_type: "GPS_OUT_OF_RANGE" as const,
        difference_metres: checkoutDistanceMetres,
        status: "PENDING" as const,
      });
    }

    if (exceptions.length > 0) {
      await adminClient.from("attendance_exceptions").insert(exceptions);

      // ── Notify admin of checkout exceptions ──
      const { data: emp } = await adminClient
        .from("employees")
        .select("full_name")
        .eq("id", ctx.employeeId)
        .single();
      const empName = emp?.full_name || "Employee";

      for (const exc of exceptions) {
        await notifyAdminException({
          businessId: ctx.businessId,
          employeeId: ctx.employeeId,
          employeeName: empName,
          shiftId,
          attendanceId: record.id,
          exceptionType: exc.exception_type,
          minutes: exc.difference_minutes,
        });
      }
    }

    // ── 10. Return result ────────────────────────────────────
    return NextResponse.json({
      success: true,
      record: updatedRecord,
      checkoutStatus,
      checkoutDistanceMetres,
      gpsOutOfRange,
      qrVerified: qrVerifiedCheckout,
      minsEarly: minsEarly > 0 ? minsEarly : 0,
      minsLate: minsLate > 0 ? minsLate : 0,
      earlyDeparture: minsEarly > earlyThreshold,  // consistent: strict >
      lateDeparture: minsLate > lateThreshold,    // consistent: strict >
      requiresReview,
      locationName: location.name,
      checkoutSelfiePath,
    }, { status: 200 });
  } catch (err) {
    return handleTenantError(err);
  }
}
