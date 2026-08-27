// POST /api/attendance/checkin — Employee check-in
//
// Accepts multipart/form-data:
//   shiftId       — required
//   qrToken       — the scanned QR string (if QR required)
//   latitude      — GPS lat  (if GPS required)
//   longitude     — GPS lng  (if GPS required)
//   selfie        — File     (if selfie required)
//   sitePhoto     — File     (if site photo required)
//
// Creates an attendance_record + any attendance_exceptions.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, handleTenantError } from "@/lib/services/tenantContext";
import { validateDynamicQrToken } from "@/lib/services/dynamicQr";
import { haversineDistanceMetres } from "@/lib/calculations/geo";
import { notifyAdminException } from "@/lib/services/notificationService";

export async function POST(request: Request) {
  try {
    const ctx = await requireMember();

    if (!ctx.employeeId) {
      return NextResponse.json({ error: "Only employees can check in." }, { status: 403 });
    }

    const formData = await request.formData();
    const shiftId = formData.get("shiftId") as string | null;

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

    // Must be assigned to this employee
    if (shift.employee_id !== ctx.employeeId) {
      return NextResponse.json({ error: "This shift is not assigned to you." }, { status: 403 });
    }

    // Must be accepted (or updated_pending — allow check-in)
    if (!["accepted", "updated_pending"].includes(shift.status)) {
      return NextResponse.json(
        { error: "You can only check in for an accepted shift." },
        { status: 400 }
      );
    }

    // ── 2. Check no existing attendance record ───────────────
    const { data: existing } = await adminClient
      .from("attendance_records")
      .select("id, checkin_status")
      .eq("shift_id", shiftId)
      .eq("business_id", ctx.businessId)
      .single();

    if (existing && existing.checkin_status !== "NOT_CHECKED_IN") {
      return NextResponse.json({ error: "You have already checked in for this shift." }, { status: 409 });
    }

    // ── 3. Load location + attendance settings ───────────────
    if (!shift.location_id) {
      return NextResponse.json({ error: "This shift has no location assigned." }, { status: 400 });
    }

    const [{ data: location }, { data: settings }] = await Promise.all([
      adminClient
        .from("work_locations")
        .select("id, name, latitude, longitude, status")
        .eq("id", shift.location_id)
        .eq("business_id", ctx.businessId)
        .single(),
      adminClient
        .from("attendance_settings")
        .select("*")
        .eq("location_id", shift.location_id)
        .eq("business_id", ctx.businessId)
        .single(),
    ]);

    if (!location) {
      return NextResponse.json({ error: "Work location not found." }, { status: 404 });
    }
    if (!settings || !settings.attendance_required) {
      return NextResponse.json({ error: "Attendance is not required for this location." }, { status: 400 });
    }

    // ── 4. Early check-in window ─────────────────────────────
    const now = new Date();
    const scheduledStart = new Date(shift.scheduled_start);
    const earlyMinutes = settings.early_checkin_minutes ?? 15;
    const earliestCheckin = new Date(scheduledStart.getTime() - earlyMinutes * 60_000);

    if (now < earliestCheckin) {
      const minsUntil = Math.ceil((earliestCheckin.getTime() - now.getTime()) / 60_000);
      return NextResponse.json(
        { error: `Too early to check in. You can check in ${minsUntil} minute${minsUntil !== 1 ? "s" : ""} before your shift.` },
        { status: 400 }
      );
    }

    // ── 5. QR verification ───────────────────────────────────
    let qrVerified = false;
    let qrMode: "STATIC" | "DYNAMIC" | null = null;

    if (settings.qr_required) {
      const qrToken = formData.get("qrToken") as string | null;
      if (!qrToken) {
        return NextResponse.json({ error: "QR scan is required." }, { status: 400 });
      }

      qrMode = (settings.qr_mode as "STATIC" | "DYNAMIC") || null;

      if (qrMode === "STATIC") {
        // Validate static QR: WFA:CHECKIN:{token}
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

        if (!credential) {
          return NextResponse.json({ error: "QR code not recognised." }, { status: 400 });
        }
        if (credential.status !== "ACTIVE") {
          return NextResponse.json({ error: "This QR code is currently paused or revoked." }, { status: 400 });
        }
        // Verify correct location
        if (credential.location_id !== shift.location_id) {
          return NextResponse.json({
            error: "Wrong work location. This QR code belongs to a different site.",
            expectedLocation: location.name,
          }, { status: 400 });
        }
        qrVerified = true;

      } else if (qrMode === "DYNAMIC") {
        // Validate dynamic QR: WFA:DYN:{payload}.{sig}
        const result = validateDynamicQrToken(qrToken);
        if (!result.valid) {
          return NextResponse.json({ error: result.error }, { status: 400 });
        }
        // Verify business
        if (result.payload.bid !== ctx.businessId) {
          return NextResponse.json({ error: "QR code does not belong to your business." }, { status: 403 });
        }
        // Verify location
        if (result.payload.lid !== shift.location_id) {
          return NextResponse.json({
            error: "Wrong work location. This QR code belongs to a different site.",
            expectedLocation: location.name,
          }, { status: 400 });
        }
        qrVerified = true;
      }
    }

    // ── 6. GPS verification ──────────────────────────────────
    let checkinLat: number | null = null;
    let checkinLng: number | null = null;
    let distanceMetres: number | null = null;
    let gpsOutOfRange = false;

    if (settings.gps_required) {
      const latStr = formData.get("latitude") as string | null;
      const lngStr = formData.get("longitude") as string | null;
      if (!latStr || !lngStr) {
        return NextResponse.json({ error: "GPS coordinates are required." }, { status: 400 });
      }
      checkinLat = parseFloat(latStr);
      checkinLng = parseFloat(lngStr);
      if (isNaN(checkinLat) || isNaN(checkinLng)) {
        return NextResponse.json({ error: "Invalid GPS coordinates." }, { status: 400 });
      }

      if (location.latitude != null && location.longitude != null) {
        distanceMetres = haversineDistanceMetres(
          checkinLat, checkinLng,
          location.latitude, location.longitude
        );
        const allowedRadius = settings.allowed_radius_metres ?? 100;
        gpsOutOfRange = distanceMetres > allowedRadius;
      }
    }

    // ── 7. Photo uploads ─────────────────────────────────────
    let selfiePhotoPath: string | null = null;
    let sitePhotoPath: string | null = null;

    const selfieFile = formData.get("selfie") as File | null;
    const sitePhotoFile = formData.get("sitePhoto") as File | null;

    if (settings.selfie_required && !selfieFile) {
      return NextResponse.json({ error: "A selfie photo is required." }, { status: 400 });
    }
    if (settings.site_photo_required && !sitePhotoFile) {
      return NextResponse.json({ error: "A site photo is required." }, { status: 400 });
    }

    const timestamp = Date.now();

    if (selfieFile) {
      const ext = selfieFile.name.split(".").pop() || "jpg";
      const path = `${ctx.employeeId}/${shiftId}/selfie_${timestamp}.${ext}`;
      const buffer = Buffer.from(await selfieFile.arrayBuffer());
      const { error: uploadErr } = await adminClient.storage
        .from("attendance-photos")
        .upload(path, buffer, { contentType: selfieFile.type, upsert: false });
      if (uploadErr) {
        return NextResponse.json({ error: "Failed to upload selfie: " + uploadErr.message }, { status: 500 });
      }
      selfiePhotoPath = path;
    }

    if (sitePhotoFile) {
      const ext = sitePhotoFile.name.split(".").pop() || "jpg";
      const path = `${ctx.employeeId}/${shiftId}/site_${timestamp}.${ext}`;
      const buffer = Buffer.from(await sitePhotoFile.arrayBuffer());
      const { error: uploadErr } = await adminClient.storage
        .from("attendance-photos")
        .upload(path, buffer, { contentType: sitePhotoFile.type, upsert: false });
      if (uploadErr) {
        return NextResponse.json({ error: "Failed to upload site photo: " + uploadErr.message }, { status: 500 });
      }
      sitePhotoPath = path;
    }

    // ── 8. Determine check-in status ─────────────────────────
    const lateGraceMinutes = settings.late_grace_minutes ?? 10;
    const minsLate = Math.max(0, Math.floor((now.getTime() - scheduledStart.getTime()) / 60_000));

    type CheckinStatus = "NOT_CHECKED_IN" | "PRESENT" | "LATE" | "NEEDS_REVIEW" | "APPROVED_MANUALLY" | "ABSENT";
    type VerificationStatus = "PENDING" | "VERIFIED" | "NEEDS_REVIEW" | "REJECTED";

    let checkinStatus: CheckinStatus;
    let verificationStatus: VerificationStatus;
    let requiresReview = false;

    if (gpsOutOfRange) {
      checkinStatus = "NEEDS_REVIEW";
      verificationStatus = "NEEDS_REVIEW";
      requiresReview = true;
    } else if (minsLate <= 0) {
      checkinStatus = "PRESENT";
      verificationStatus = "PENDING";
    } else if (minsLate <= lateGraceMinutes) {
      checkinStatus = "PRESENT";
      verificationStatus = "PENDING";
    } else {
      checkinStatus = "LATE";
      verificationStatus = "NEEDS_REVIEW";
      requiresReview = true;
    }

    // ── 9. Create attendance record ──────────────────────────
    const recordData = {
      business_id: ctx.businessId,
      shift_id: shiftId,
      employee_id: ctx.employeeId,
      location_id: shift.location_id,
      scheduled_start: shift.scheduled_start,
      scheduled_finish: shift.scheduled_finish,
      actual_checkin: now.toISOString(),
      checkin_status: checkinStatus,
      qr_mode: qrMode,
      qr_verified: qrVerified,
      checkin_latitude: checkinLat,
      checkin_longitude: checkinLng,
      checkin_distance_metres: distanceMetres,
      selfie_photo_path: selfiePhotoPath,
      site_photo_path: sitePhotoPath,
      verification_status: verificationStatus,
      requires_review: requiresReview,
    };

    let record;
    if (existing) {
      // Update existing NOT_CHECKED_IN record
      const { data, error } = await adminClient
        .from("attendance_records")
        .update(recordData)
        .eq("id", existing.id)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      record = data;
    } else {
      const { data, error } = await adminClient
        .from("attendance_records")
        .insert(recordData)
        .select()
        .single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      record = data;
    }

    // ── 10. Create exceptions ────────────────────────────────
    type ExceptionType = "LATE_ARRIVAL" | "EARLY_ARRIVAL" | "EARLY_DEPARTURE" | "LATE_DEPARTURE" | "GPS_OUT_OF_RANGE" | "QR_MISMATCH" | "MISSING_SELFIE" | "MISSING_SITE_PHOTO";
    type ExceptionStatus = "PENDING" | "APPROVED" | "REJECTED" | "NOTED";

    const exceptions: Array<{
      business_id: string;
      attendance_record_id: string;
      employee_id: string;
      shift_id: string;
      exception_type: ExceptionType;
      difference_minutes?: number;
      difference_metres?: number;
      status: ExceptionStatus;
    }> = [];

    if (minsLate > lateGraceMinutes) {
      exceptions.push({
        business_id: ctx.businessId,
        attendance_record_id: record.id,
        employee_id: ctx.employeeId,
        shift_id: shiftId,
        exception_type: "LATE_ARRIVAL" as const,
        difference_minutes: minsLate,
        status: "PENDING" as const,
      });
    }

    if (gpsOutOfRange && distanceMetres != null) {
      exceptions.push({
        business_id: ctx.businessId,
        attendance_record_id: record.id,
        employee_id: ctx.employeeId,
        shift_id: shiftId,
        exception_type: "GPS_OUT_OF_RANGE" as const,
        difference_metres: distanceMetres,
        status: "PENDING" as const,
      });
    }

    if (exceptions.length > 0) {
      await adminClient.from("attendance_exceptions").insert(exceptions);

      // ── Notify admin of exceptions (only for meaningful events) ──
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

    // ── 11. Return result ────────────────────────────────────
    return NextResponse.json({
      success: true,
      record,
      checkinStatus,
      distanceMetres,
      gpsOutOfRange,
      qrVerified,
      minsLate: minsLate > 0 ? minsLate : 0,
      withinGrace: minsLate > 0 && minsLate <= lateGraceMinutes,
      requiresReview,
      locationName: location.name,
    }, { status: 201 });
  } catch (err) {
    return handleTenantError(err);
  }
}
