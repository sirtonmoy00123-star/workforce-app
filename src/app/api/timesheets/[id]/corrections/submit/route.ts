// POST /api/timesheets/[id]/corrections/submit — employee submits a correction
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, handleTenantError } from "@/lib/services/tenantContext";
import { recalculateForCorrection } from "@/lib/services/timesheetService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: timesheetId } = await params;
    const ctx = await requireRole("EMPLOYEE");

    if (!ctx.employeeId) {
      return NextResponse.json({ error: "Employee not found." }, { status: 403 });
    }

    const adminClient = createAdminClient();

    // Get the timesheet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: timesheet } = await adminClient
      .from("timesheets")
      .select("*")
      .eq("id", timesheetId)
      .single() as { data: any };

    if (!timesheet) {
      return NextResponse.json({ error: "Timesheet not found." }, { status: 404 });
    }

    // Verify ownership and business
    if (timesheet.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    if (timesheet.employee_id !== ctx.employeeId) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    // Check status
    if (timesheet.status !== "correction_required") {
      return NextResponse.json({ error: "This timesheet is not awaiting correction." }, { status: 400 });
    }

    // Get the pending correction
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: correction } = await (adminClient as any)
      .from("timesheet_corrections")
      .select("*")
      .eq("timesheet_id", timesheetId)
      .eq("status", "pending")
      .order("correction_round", { ascending: false })
      .limit(1)
      .single();

    if (!correction) {
      return NextResponse.json({ error: "No pending correction found." }, { status: 404 });
    }

    const body = await request.json();
    const { corrected_values, employee_note } = body;

    // Validate employee_note required
    if (!employee_note || employee_note.trim().length === 0) {
      return NextResponse.json({ error: "An explanation note is required." }, { status: 400 });
    }

    // Validate only requested fields are being changed
    const requestedFields: string[] = correction.requested_fields;
    const allowedFields = new Set(requestedFields);

    // Build final values starting from current timesheet data
    let finalActualStart = timesheet.actual_start;
    let finalActualFinish = timesheet.actual_finish;
    let finalStartOdometer = timesheet.start_odometer;
    let finalFinishOdometer = timesheet.finish_odometer;

    // Apply only permitted changes
    if (corrected_values.actual_start !== undefined) {
      if (!allowedFields.has("actual_start")) {
        return NextResponse.json({ error: "You are not allowed to change start time." }, { status: 403 });
      }
      finalActualStart = corrected_values.actual_start;
    }
    if (corrected_values.actual_finish !== undefined) {
      if (!allowedFields.has("actual_finish")) {
        return NextResponse.json({ error: "You are not allowed to change finish time." }, { status: 403 });
      }
      finalActualFinish = corrected_values.actual_finish;
    }
    if (corrected_values.start_odometer !== undefined) {
      if (!allowedFields.has("start_odometer")) {
        return NextResponse.json({ error: "You are not allowed to change starting odometer." }, { status: 403 });
      }
      finalStartOdometer = Number(corrected_values.start_odometer);
    }
    if (corrected_values.finish_odometer !== undefined) {
      if (!allowedFields.has("finish_odometer")) {
        return NextResponse.json({ error: "You are not allowed to change ending odometer." }, { status: 403 });
      }
      finalFinishOdometer = Number(corrected_values.finish_odometer);
    }

    // Validate times
    const startDate = new Date(finalActualStart);
    const finishDate = new Date(finalActualFinish);
    if (finishDate <= startDate) {
      return NextResponse.json({ error: "Finish time must be after start time." }, { status: 400 });
    }

    // Validate odometer
    if (finalFinishOdometer < finalStartOdometer) {
      return NextResponse.json({ error: "Ending odometer cannot be lower than starting odometer." }, { status: 400 });
    }

    // Fetch the shift's scheduled times for payable time engine
    const { data: shift } = await adminClient
      .from("shifts")
      .select("scheduled_start, scheduled_finish")
      .eq("id", timesheet.shift_id)
      .single();

    // Recalculate via unified timesheet service (routes through payable time engine)
    const calc = recalculateForCorrection(
      finalActualStart,
      finalActualFinish,
      finalStartOdometer,
      finalFinishOdometer,
      timesheet.hourly_rate_snapshot,
      timesheet.mileage_rate_snapshot,
      shift?.scheduled_start,
      shift?.scheduled_finish
    );

    // Build corrected values snapshot
    const correctedSnapshot = {
      actual_start: finalActualStart,
      actual_finish: finalActualFinish,
      start_odometer: finalStartOdometer,
      finish_odometer: finalFinishOdometer,
    };

    const recalculatedValues = {
      worked_minutes: calc.workedMinutes,
      payable_worked_minutes: calc.payableWorkedMinutes,
      distance_km: calc.distanceKm,
      wage_amount: calc.wageAmount,
      mileage_amount: calc.mileageAmount,
      total_amount: calc.totalAmount,
    };

    // Update the correction record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateCorrError } = await (adminClient as any)
      .from("timesheet_corrections")
      .update({
        corrected_values: correctedSnapshot,
        recalculated_values: recalculatedValues,
        employee_note: employee_note.trim(),
        submitted_at: new Date().toISOString(),
        status: "submitted",
        replacement_start_photo: corrected_values.replacement_start_photo || null,
        replacement_finish_photo: corrected_values.replacement_finish_photo || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", correction.id);

    if (updateCorrError) {
      return NextResponse.json({ error: updateCorrError.message }, { status: 500 });
    }

    // Update the timesheet with corrected values (including payable fields)
    const { error: updateTsError } = await adminClient
      .from("timesheets")
      .update({
        actual_start: finalActualStart,
        actual_finish: finalActualFinish,
        start_odometer: finalStartOdometer,
        finish_odometer: finalFinishOdometer,
        worked_minutes: calc.workedMinutes,
        payable_worked_minutes: calc.payableWorkedMinutes,
        paid_break_minutes: calc.paidBreakMinutes,
        unpaid_break_minutes: calc.unpaidBreakMinutes,
        distance_km: calc.distanceKm,
        wage_amount: calc.wageAmount,
        mileage_amount: calc.mileageAmount,
        total_amount: calc.totalAmount,
        status: "correction_submitted",
      })
      .eq("id", timesheetId);

    if (updateTsError) {
      return NextResponse.json({ error: updateTsError.message }, { status: 500 });
    }

    // Also update the work_session to keep it in sync with corrected values
    if (timesheet.work_session_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (adminClient as any)
        .from("work_sessions")
        .update({
          actual_start_at: finalActualStart,
          actual_finish_at: finalActualFinish,
          payable_start_at: calc.payableStartAt,
          payable_finish_at: calc.payableFinishAt,
          actual_worked_minutes: calc.workedMinutes,
          payable_worked_minutes: calc.payableWorkedMinutes,
          paid_break_minutes: calc.paidBreakMinutes,
          unpaid_break_minutes: calc.unpaidBreakMinutes,
          requires_review: true,
        })
        .eq("id", timesheet.work_session_id);
    }

    return NextResponse.json({
      success: true,
      status: "correction_submitted",
      recalculated: recalculatedValues,
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
