// POST /api/shifts/[id]/finish — Employee finishes a shift
// Uploads finish odometer photo, updates attendance, auto-generates timesheet
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, handleTenantError } from "@/lib/services/tenantContext";
import { calculateWorkedMinutes } from "@/lib/calculations/time";
import { calculateMileage } from "@/lib/calculations/mileage";
import { calculatePayment } from "@/lib/calculations/payment";

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

    // Get the shift
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

    // Get attendance record (must be "working")
    const { data: attendance } = await adminClient
      .from("shift_attendance")
      .select("*")
      .eq("shift_id", shiftId)
      .eq("employee_id", ctx.employeeId)
      .single();

    if (!attendance || attendance.attendance_status !== "working") {
      return NextResponse.json({ error: "This shift has not been started yet." }, { status: 400 });
    }

    // Get the start odometer submission
    const { data: startOdometer } = await adminClient
      .from("odometer_submissions")
      .select("*")
      .eq("shift_id", shiftId)
      .eq("employee_id", ctx.employeeId)
      .eq("submission_type", "START")
      .single();

    if (!startOdometer) {
      return NextResponse.json({ error: "Start odometer record not found." }, { status: 400 });
    }

    // Parse the form data
    const formData = await request.formData();
    const photo = formData.get("photo") as File | null;
    const odometerReading = parseFloat(formData.get("odometer_reading") as string);

    if (!photo) {
      return NextResponse.json({ error: "Odometer photo is required." }, { status: 400 });
    }
    if (isNaN(odometerReading) || odometerReading < 0) {
      return NextResponse.json({ error: "Valid odometer reading is required." }, { status: 400 });
    }
    if (odometerReading < startOdometer.odometer_reading) {
      return NextResponse.json({
        error: `Finish odometer (${odometerReading}) cannot be less than start odometer (${startOdometer.odometer_reading}).`,
      }, { status: 400 });
    }

    // Upload photo
    const fileExt = photo.name.split(".").pop() || "jpg";
    const fileName = `${ctx.employeeId}/${shiftId}/finish_${Date.now()}.${fileExt}`;
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

    // Server timestamp for actual_finish
    const serverNow = new Date().toISOString();

    // Create finish odometer submission
    const { error: odometerError } = await adminClient
      .from("odometer_submissions")
      .insert({
        shift_id: shiftId,
        employee_id: ctx.employeeId,
        business_id: ctx.businessId,
        submission_type: "FINISH",
        photo_path: fileName,
        odometer_reading: odometerReading,
        server_timestamp: serverNow,
      });

    if (odometerError) {
      console.error("Odometer submission error:", odometerError);
      return NextResponse.json({ error: "Failed to save odometer reading." }, { status: 500 });
    }

    // Update attendance: set actual_finish and status to completed
    const { error: attendanceError } = await adminClient
      .from("shift_attendance")
      .update({
        actual_finish: serverNow,
        attendance_status: "completed",
      })
      .eq("id", attendance.id);

    if (attendanceError) {
      console.error("Attendance update error:", attendanceError);
      return NextResponse.json({ error: "Failed to update attendance." }, { status: 500 });
    }

    // Update shift status to completed
    const { error: shiftError } = await adminClient
      .from("shifts")
      .update({ status: "completed" })
      .eq("id", shiftId);

    if (shiftError) {
      console.error("Shift update error:", shiftError);
      return NextResponse.json({ error: "Failed to update shift status." }, { status: 500 });
    }

    // === AUTO-GENERATE TIMESHEET ===
    // Get employee for rate snapshot
    const { data: employee } = await adminClient
      .from("employees")
      .select("hourly_rate, mileage_rate")
      .eq("id", ctx.employeeId)
      .single();

    if (!employee) {
      return NextResponse.json({
        success: true,
        actual_finish: serverNow,
        message: "Shift finished but could not find employee rates for timesheet.",
        timesheet_error: true,
      });
    }

    const actualStart = new Date(attendance.actual_start!);
    const actualFinish = new Date(serverNow);
    const workedMinutes = calculateWorkedMinutes(actualStart, actualFinish);
    const distanceKm = calculateMileage(startOdometer.odometer_reading, odometerReading);

    // Snapshot the employee's current rates
    const hourlyRateSnapshot = employee.hourly_rate;
    const mileageRateSnapshot = employee.mileage_rate;

    const payment = calculatePayment(workedMinutes, distanceKm, hourlyRateSnapshot, mileageRateSnapshot);

    const { data: timesheet, error: timesheetError } = await adminClient
      .from("timesheets")
      .insert({
        shift_id: shiftId,
        employee_id: ctx.employeeId,
        business_id: ctx.businessId,
        scheduled_start: shift.scheduled_start,
        scheduled_finish: shift.scheduled_finish,
        actual_start: attendance.actual_start!,
        actual_finish: serverNow,
        worked_minutes: workedMinutes,
        start_odometer: startOdometer.odometer_reading,
        finish_odometer: odometerReading,
        distance_km: distanceKm,
        hourly_rate_snapshot: hourlyRateSnapshot,
        mileage_rate_snapshot: mileageRateSnapshot,
        wage_amount: payment.wageAmount,
        mileage_amount: payment.mileageAmount,
        estimated_total: payment.estimatedTotal,
        status: "submitted",
      })
      .select()
      .single();

    if (timesheetError) {
      console.error("Timesheet creation error:", timesheetError);
      // Shift is already completed — don't fail the whole request
      return NextResponse.json({
        success: true,
        actual_finish: serverNow,
        message: "Shift finished but timesheet generation failed. Admin will review.",
        timesheet_error: true,
      });
    }

    return NextResponse.json({
      success: true,
      actual_finish: serverNow,
      message: "Shift finished and timesheet submitted!",
      timesheet: {
        id: timesheet.id,
        worked_minutes: workedMinutes,
        distance_km: distanceKm,
        wage_amount: payment.wageAmount,
        mileage_amount: payment.mileageAmount,
        estimated_total: payment.estimatedTotal,
      },
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
