// POST /api/shifts/[id]/start — Employee starts a shift
// Creates work_sessions record, optionally uploads odometer photo + saves odometer submission
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, handleTenantError } from "@/lib/services/tenantContext";
import { canStartWork, type ShiftState } from "@/lib/services/shiftStateMachine";
import { startWorkSession } from "@/lib/services/workSessionService";
import { workSessionAudit } from "@/lib/services/auditService";
import { validateImageFile, validateImageMagicBytes } from "@/lib/validation/workSession.schema";
import { apiError, ErrorCode } from "@/lib/validation/errors";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: shiftId } = await params;
    const ctx = await requireRole("EMPLOYEE");

    if (!ctx.employeeId) {
      return NextResponse.json({ error: "Employee record not found." }, { status: 404 });
    }

    const adminClient = createAdminClient();

    // Get the shift and verify ownership + business
    const { data: shift } = await adminClient
      .from("shifts")
      .select("*")
      .eq("id", shiftId)
      .single();

    if (!shift) {
      return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    }
    if (shift.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (shift.employee_id !== ctx.employeeId) {
      return NextResponse.json({ error: "This shift is not assigned to you." }, { status: 403 });
    }

    // ── State machine guard ──
    // Check attendance requirement for the state machine
    let attendanceRequired = false;
    if (shift.location_id) {
      const { data: attSettings } = await adminClient
        .from("attendance_settings")
        .select("attendance_required")
        .eq("location_id", shift.location_id)
        .eq("business_id", ctx.businessId)
        .single();
      attendanceRequired = !!attSettings?.attendance_required;
    }

    // Check if already has a work session
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingSession } = await (adminClient as any)
      .from("work_sessions")
      .select("id, status")
      .eq("shift_id", shiftId)
      .eq("employee_id", ctx.employeeId)
      .maybeSingle();

    // Check attendance check-in status
    let hasCheckedIn = false;
    if (attendanceRequired) {
      const { data: attRecord } = await adminClient
        .from("attendance_records")
        .select("checkin_status")
        .eq("shift_id", shiftId)
        .eq("business_id", ctx.businessId)
        .maybeSingle();
      hasCheckedIn = !!attRecord && attRecord.checkin_status !== "NOT_CHECKED_IN";
    }

    const shiftState: ShiftState = {
      shiftStatus: shift.status,
      workSessionStatus: existingSession?.status || null,
      hasCheckedIn,
    };

    const guard = canStartWork(shiftState, attendanceRequired);
    if (!guard.allowed) {
      return NextResponse.json({ error: guard.reason }, { status: 400 });
    }

    // Check odometer requirement: per-shift override > employee default
    const { data: employee } = await adminClient
      .from("employees")
      .select("odometer_tracking_enabled")
      .eq("id", ctx.employeeId)
      .single();

    const odometerEnabled = shift.require_odometer !== null
      ? shift.require_odometer                          // per-shift override
      : employee?.odometer_tracking_enabled !== false;   // employee default

    // Parse the form data (multipart for photo upload)
    const formData = await request.formData();
    const photo = formData.get("photo") as File | null;
    const odometerReadingStr = formData.get("odometer_reading") as string;
    const odometerReading = odometerReadingStr ? parseFloat(odometerReadingStr) : NaN;

    // Server timestamp for actual_start
    const serverNow = new Date().toISOString();

    if (odometerEnabled) {
      // Odometer is required
      if (!photo) {
        return apiError(ErrorCode.ODOMETER_REQUIRED, "Odometer photo is required.");
      }
      if (isNaN(odometerReading) || odometerReading < 0) {
        return apiError(ErrorCode.INVALID_INPUT, "Valid odometer reading is required.");
      }

      // Validate file: size, MIME type, magic bytes
      const fileErr = validateImageFile(photo);
      if (fileErr) {
        return apiError(ErrorCode.INVALID_FILE, fileErr);
      }

      // Upload photo to Supabase Storage (odometer-photos bucket)
      // Use generated filename (never trust client filename)
      const arrayBuffer = await photo.arrayBuffer();
      const fileBuffer = new Uint8Array(arrayBuffer);

      // Validate magic bytes (actual content, not just MIME header)
      if (!validateImageMagicBytes(fileBuffer)) {
        return apiError(ErrorCode.INVALID_FILE, "File content does not match a valid image format.");
      }

      const ext = photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
      const fileName = `${ctx.employeeId}/${shiftId}/start_${Date.now()}.${ext}`;

      const { error: uploadError } = await adminClient.storage
        .from("odometer-photos")
        .upload(fileName, fileBuffer, {
          contentType: photo.type || "image/jpeg",
          upsert: false,
        });

      if (uploadError) {
        console.error("Photo upload error:", uploadError);
        return NextResponse.json({ error: "Failed to upload photo." }, { status: 500 });
      }

      // Create odometer submission record
      const { error: odometerError } = await adminClient
        .from("odometer_submissions")
        .insert({
          shift_id: shiftId,
          employee_id: ctx.employeeId,
          business_id: ctx.businessId,
          submission_type: "START",
          photo_path: fileName,
          odometer_reading: odometerReading,
          server_timestamp: serverNow,
        });

      if (odometerError) {
        console.error("Odometer submission error:", odometerError);
        return NextResponse.json({ error: "Failed to save odometer reading." }, { status: 500 });
      }
    }

    // ── Create work session (idempotent) ──
    const result = await startWorkSession(adminClient, {
      shiftId,
      employeeId: ctx.employeeId,
      businessId: ctx.businessId,
      serverTimestamp: serverNow,
    });

    // Fire-and-forget audit
    workSessionAudit(
      "WORK_SESSION_STARTED",
      { businessId: ctx.businessId, userId: ctx.userId, role: "EMPLOYEE" },
      result.workSessionId,
      { after: { shift_id: shiftId, actual_start_at: result.actualStartAt } }
    );

    return NextResponse.json({
      success: true,
      actual_start: result.actualStartAt,
      message: "Shift started successfully.",
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
