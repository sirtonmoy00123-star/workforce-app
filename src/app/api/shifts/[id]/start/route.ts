// POST /api/shifts/[id]/start — Employee starts a shift
// Creates shift_attendance record, optionally uploads odometer photo + saves odometer submission
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, handleTenantError } from "@/lib/services/tenantContext";

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
    if (shift.status !== "accepted") {
      return NextResponse.json({ error: "Only accepted shifts can be started." }, { status: 400 });
    }

    // Check if already started (attendance record exists)
    const { data: existingAttendance } = await adminClient
      .from("shift_attendance")
      .select("id")
      .eq("shift_id", shiftId)
      .eq("employee_id", ctx.employeeId)
      .maybeSingle();

    if (existingAttendance) {
      return NextResponse.json({ error: "This shift has already been started." }, { status: 400 });
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
        return NextResponse.json({ error: "Odometer photo is required." }, { status: 400 });
      }
      if (isNaN(odometerReading) || odometerReading < 0) {
        return NextResponse.json({ error: "Valid odometer reading is required." }, { status: 400 });
      }

      // Upload photo to Supabase Storage (odometer-photos bucket)
      const fileExt = photo.name.split(".").pop() || "jpg";
      const fileName = `${ctx.employeeId}/${shiftId}/start_${Date.now()}.${fileExt}`;
      const arrayBuffer = await photo.arrayBuffer();
      const fileBuffer = new Uint8Array(arrayBuffer);

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

      // Create shift_attendance record
      const { error: attendanceError } = await adminClient
        .from("shift_attendance")
        .insert({
          shift_id: shiftId,
          employee_id: ctx.employeeId,
          business_id: ctx.businessId,
          actual_start: serverNow,
          attendance_status: "working",
        });

      if (attendanceError) {
        console.error("Attendance insert error:", attendanceError);
        return NextResponse.json({ error: "Failed to record attendance." }, { status: 500 });
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
    } else {
      // No odometer — just create attendance record
      const { error: attendanceError } = await adminClient
        .from("shift_attendance")
        .insert({
          shift_id: shiftId,
          employee_id: ctx.employeeId,
          business_id: ctx.businessId,
          actual_start: serverNow,
          attendance_status: "working",
        });

      if (attendanceError) {
        console.error("Attendance insert error:", attendanceError);
        return NextResponse.json({ error: "Failed to record attendance." }, { status: 500 });
      }
    }

    return NextResponse.json({
      success: true,
      actual_start: serverNow,
      message: "Shift started successfully.",
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
