// GET /api/shifts/[id] — get single shift details
// PUT /api/shifts/[id] — accept/decline (employee) OR preview/update (admin edit)
// DELETE /api/shifts/[id] — admin permanently deletes an UNWORKED shift
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, requireAdmin, handleTenantError } from "@/lib/services/tenantContext";
import {
  validateShiftAssignment,
  requiresEmployeeReconfirmation,
  type ShiftAssignmentInput,
  type EmployeeData,
  type AvailabilityData,
  type ExistingShiftData,
  type AttendanceData,
} from "@/lib/services/shiftValidation";
import { canAcceptShift, canDeclineShift, type ShiftState } from "@/lib/services/shiftStateMachine";
import { getWorkSession } from "@/lib/services/workSessionService";
import { shiftAudit } from "@/lib/services/auditService";
import { buildShiftTimestamps, getBusinessTimezone } from "@/lib/calculations/timezone";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireMember();
    const adminClient = createAdminClient();

    const { data: shift, error } = await adminClient
      .from("shifts")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !shift) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }

    // Verify access: must be same business
    if (shift.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Employee can only see their own shifts
    if (ctx.role === "EMPLOYEE" && shift.employee_id !== ctx.employeeId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Also get employee name for display
    const { data: employee } = await adminClient
      .from("employees")
      .select("full_name, employee_number")
      .eq("id", shift.employee_id)
      .single();

    // Get work session status if exists
    const workSession = await getWorkSession(adminClient, id);
    // Map to the shape the frontend expects (backward compat)
    const attendance = workSession
      ? {
          attendance_status: workSession.status,
          actual_start: workSession.actual_start_at,
          actual_finish: workSession.actual_finish_at,
        }
      : null;

    return NextResponse.json({ ...shift, employee, attendance });
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireMember();

    const body = await request.json();
    const { action } = body;

    const adminClient = createAdminClient();

    // Get shift
    const { data: shift } = await adminClient
      .from("shifts")
      .select("*")
      .eq("id", id)
      .single();

    if (!shift) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }

    // Must be same business
    if (shift.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ── Employee actions: accept / decline / accept_updated ──
    if (ctx.role === "EMPLOYEE") {
      if (shift.employee_id !== ctx.employeeId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // Build state for guard functions
      const ws = await getWorkSession(adminClient, id);
      const shiftState: ShiftState = {
        shiftStatus: shift.status,
        workSessionStatus: ws?.status || null,
        hasCheckedIn: false,
      };

      if (action === "accept" || action === "accept_updated") {
        const guard = canAcceptShift(shiftState);
        if (!guard.allowed) {
          return NextResponse.json({ error: guard.reason }, { status: 400 });
        }
        const { error } = await adminClient
          .from("shifts")
          .update({ status: "accepted" })
          .eq("id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        // Fire-and-forget audit
        shiftAudit(
          "SHIFT_ACCEPTED",
          { businessId: ctx.businessId, userId: ctx.userId, role: "EMPLOYEE" },
          id,
          { before: { status: shift.status }, after: { status: "accepted" } }
        );

        return NextResponse.json({ success: true, status: "accepted" });
      }

      if (action === "decline") {
        const guard = canDeclineShift(shiftState);
        if (!guard.allowed) {
          return NextResponse.json({ error: guard.reason }, { status: 400 });
        }
        const { error } = await adminClient
          .from("shifts")
          .update({ status: "declined" })
          .eq("id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        // Fire-and-forget audit
        shiftAudit(
          "SHIFT_DECLINED",
          { businessId: ctx.businessId, userId: ctx.userId, role: "EMPLOYEE" },
          id,
          { before: { status: shift.status }, after: { status: "declined" } }
        );

        return NextResponse.json({ success: true, status: "declined" });
      }

      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // ── Admin actions: preview_edit / update_shift ──
    if (ctx.role === "OWNER" || ctx.role === "ADMIN") {
      if (action === "preview_edit") {
        return handlePreviewEdit(id, body, shift, adminClient);
      }

      if (action === "update_shift") {
        return handleUpdateShift(id, body, shift, ctx, adminClient);
      }

      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireAdmin();

    const body = await request.json().catch(() => ({}));
    const { deleteReason } = body;

    if (!deleteReason || !String(deleteReason).trim()) {
      return NextResponse.json(
        { error: "A reason for deleting this shift is required." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    const { data: shift } = await adminClient
      .from("shifts")
      .select("*")
      .eq("id", id)
      .single();

    if (!shift) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }

    // Tenant isolation — never trust the id alone.
    if (shift.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ── Only UNWORKED shifts may be deleted. ──
    // Anything with real work history is payroll evidence and must survive.
    if (shift.status === "completed") {
      return NextResponse.json(
        { error: "This shift has been completed and cannot be deleted." },
        { status: 400 }
      );
    }

    const ws = await getWorkSession(adminClient, id);

    if (ws) {
      return NextResponse.json(
        { error: "This shift has already been started and cannot be deleted." },
        { status: 400 }
      );
    }

    const { data: timesheet } = await adminClient
      .from("timesheets")
      .select("id")
      .eq("shift_id", id)
      .maybeSingle();

    if (timesheet) {
      return NextResponse.json(
        { error: "This shift has a timesheet and cannot be deleted." },
        { status: 400 }
      );
    }

    const { data: odometer } = await adminClient
      .from("odometer_submissions")
      .select("id")
      .eq("shift_id", id)
      .limit(1);

    if (odometer && odometer.length > 0) {
      return NextResponse.json(
        { error: "This shift has odometer records and cannot be deleted." },
        { status: 400 }
      );
    }

    const { data: proof } = await adminClient
      .from("task_proof_submissions")
      .select("id")
      .eq("shift_id", id)
      .limit(1);

    if (proof && proof.length > 0) {
      return NextResponse.json(
        { error: "This shift has task proof photos and cannot be deleted." },
        { status: 400 }
      );
    }

    // ── Write the audit record BEFORE deleting. ──
    // The FK is ON DELETE SET NULL, so this row survives the shift.
    const { error: auditError } = await adminClient
      .from("shift_audit_log")
      .insert({
        shift_id: id,
        deleted_shift_id: id,
        employee_id: shift.employee_id,
        business_id: shift.business_id,
        changed_by: ctx.userId,
        original_date: shift.date,
        original_start: shift.scheduled_start,
        original_finish: shift.scheduled_finish,
        original_location: shift.location,
        original_instructions: shift.instructions,
        original_status: shift.status,
        new_status: "deleted",
        change_reason: "shift_deleted",
        change_notes: String(deleteReason).trim(),
      });

    if (auditError) {
      console.error("Delete audit log error:", auditError);
      return NextResponse.json(
        { error: "Failed to record the deletion. Shift was not deleted." },
        { status: 500 }
      );
    }

    // Task proof requirements are config, not evidence — remove them with the shift.
    await adminClient.from("task_proof_requirements").delete().eq("shift_id", id);

    const { error: deleteError } = await adminClient
      .from("shifts")
      .delete()
      .eq("id", id)
      .eq("business_id", ctx.businessId);

    if (deleteError) {
      console.error("Shift delete error:", deleteError);
      return NextResponse.json({ error: "Failed to delete shift." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "Shift deleted.",
    });
  } catch (err) {
    return handleTenantError(err);
  }
}

// ── Preview edit: run validation and return results ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePreviewEdit(shiftId: string, body: any, shift: any, adminClient: any) {
  const { date, startTime, endTime, location, instructions } = body;

  if (!date || !startTime || !endTime) {
    return NextResponse.json({ error: "Date, start time, and end time are required." }, { status: 400 });
  }

  // Fetch employee data
  const { data: employee } = await adminClient
    .from("employees")
    .select("id, full_name, employment_status")
    .eq("id", shift.employee_id)
    .single();

  if (!employee) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  // Fetch availability
  const shiftDate = new Date(date + "T00:00:00");
  const dayOfWeek = shiftDate.getDay();

  const { data: availability } = await adminClient
    .from("employee_availability")
    .select("day_of_week, is_available, start_time, end_time")
    .eq("employee_id", shift.employee_id)
    .eq("day_of_week", dayOfWeek)
    .maybeSingle();

  // Fetch existing shifts for overlap check — include adjacent days
  // so overnight shifts crossing midnight are caught
  const prevDay = new Date(new Date(date + "T12:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  const nextDay = new Date(new Date(date + "T12:00:00Z").getTime() + 86400000).toISOString().slice(0, 10);
  const { data: existingShifts } = await adminClient
    .from("shifts")
    .select("id, employee_id, date, scheduled_start, scheduled_finish, status")
    .eq("employee_id", shift.employee_id)
    .gte("date", prevDay)
    .lte("date", nextDay);

  // Fetch work session status (replaces shift_attendance for preview)
  const previewWs = await getWorkSession(adminClient, shiftId);
  const attendance: AttendanceData | null = previewWs
    ? { shift_id: shiftId, attendance_status: previewWs.status }
    : null;

  // Build timestamps for timezone-safe validation
  let previewStartISO: string | undefined;
  let previewFinishISO: string | undefined;
  try {
    const tz = await getBusinessTimezone(shift.business_id);
    const stamps = buildShiftTimestamps(date, startTime, endTime, tz);
    previewStartISO = stamps.scheduledStart;
    previewFinishISO = stamps.scheduledFinish;
  } catch {
    // If timezone lookup fails, validation will use fallback
  }

  const input: ShiftAssignmentInput = {
    employeeId: shift.employee_id,
    date,
    startTime,
    endTime,
    location,
    instructions,
    excludeShiftId: shiftId,
    scheduledStartISO: previewStartISO,
    scheduledFinishISO: previewFinishISO,
  };

  const result = validateShiftAssignment(
    input,
    employee as EmployeeData,
    availability as AvailabilityData | null,
    (existingShifts || []) as ExistingShiftData[],
    attendance,
    shift.status
  );

  // Determine if this change requires employee reconfirmation
  const needsReconfirmation = shift.status === "accepted" && requiresEmployeeReconfirmation(
    {
      date: shift.date,
      scheduled_start: shift.scheduled_start,
      scheduled_finish: shift.scheduled_finish,
      location: shift.location,
    },
    { date, startTime, endTime, location }
  );

  // Check if this is a recurring shift
  const isRecurring = !!shift.recurring_group_id;

  return NextResponse.json({
    success: true,
    validation: result,
    needsReconfirmation,
    isRecurring,
    original: {
      date: shift.date,
      scheduled_start: shift.scheduled_start,
      scheduled_finish: shift.scheduled_finish,
      location: shift.location,
      instructions: shift.instructions,
      status: shift.status,
    },
    employee: {
      full_name: employee.full_name,
    },
  });
}

// ── Save the edit ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleUpdateShift(shiftId: string, body: any, shift: any, ctx: any, adminClient: any) {
  const { date, startTime, endTime, location, instructions, changeReason, changeNotes, overrideReason, timezoneOffsetMinutes, requireOdometer } = body;

  if (!date || !startTime || !endTime) {
    return NextResponse.json({ error: "Date, start time, and end time are required." }, { status: 400 });
  }

  if (!changeReason) {
    return NextResponse.json({ error: "A reason for the change is required." }, { status: 400 });
  }

  // Re-run validation server-side (never trust the client)
  const { data: employee } = await adminClient
    .from("employees")
    .select("id, full_name, employment_status")
    .eq("id", shift.employee_id)
    .single();

  if (!employee) {
    return NextResponse.json({ error: "Employee not found." }, { status: 404 });
  }

  const shiftDate = new Date(date + "T00:00:00");
  const dayOfWeek = shiftDate.getDay();

  const { data: availability } = await adminClient
    .from("employee_availability")
    .select("day_of_week, is_available, start_time, end_time")
    .eq("employee_id", shift.employee_id)
    .eq("day_of_week", dayOfWeek)
    .maybeSingle();

  // Include adjacent days for overnight shift overlap detection
  const updatePrevDay = new Date(new Date(date + "T12:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  const updateNextDay = new Date(new Date(date + "T12:00:00Z").getTime() + 86400000).toISOString().slice(0, 10);
  const { data: existingShifts } = await adminClient
    .from("shifts")
    .select("id, employee_id, date, scheduled_start, scheduled_finish, status")
    .eq("employee_id", shift.employee_id)
    .gte("date", updatePrevDay)
    .lte("date", updateNextDay);

  // Fetch work session status (replaces shift_attendance for update validation)
  const updateWs = await getWorkSession(adminClient, shiftId);
  const updateAttendance: AttendanceData | null = updateWs
    ? { shift_id: shiftId, attendance_status: updateWs.status }
    : null;

  const input: ShiftAssignmentInput = {
    employeeId: shift.employee_id,
    date,
    startTime,
    endTime,
    location,
    instructions,
    excludeShiftId: shiftId,
    scheduledStartISO: newScheduledStart,
    scheduledFinishISO: newScheduledFinish,
  };

  const result = validateShiftAssignment(
    input,
    employee as EmployeeData,
    availability as AvailabilityData | null,
    (existingShifts || []) as ExistingShiftData[],
    updateAttendance,
    shift.status
  );

  // Block on errors
  if (!result.valid) {
    return NextResponse.json({
      error: "Validation failed",
      validation: result,
    }, { status: 400 });
  }

  // If there are warnings and no override reason, block
  if (result.warnings.length > 0 && !overrideReason) {
    return NextResponse.json({
      error: "Warnings require an override reason.",
      validation: result,
    }, { status: 409 });
  }

  // Build new timestamps using business timezone (IANA-based, DST-safe)
  // Falls back to legacy offset approach if timezone lookup fails
  let newScheduledStart: string;
  let newScheduledFinish: string;
  try {
    const tz = await getBusinessTimezone(shift.business_id);
    const stamps = buildShiftTimestamps(date, startTime, endTime, tz);
    newScheduledStart = stamps.scheduledStart;
    newScheduledFinish = stamps.scheduledFinish;
  } catch {
    const offsetMin = typeof timezoneOffsetMinutes === "number" ? timezoneOffsetMinutes : 0;
    const sign = offsetMin <= 0 ? "+" : "-";
    const absMin = Math.abs(offsetMin);
    const offH = String(Math.floor(absMin / 60)).padStart(2, "0");
    const offM = String(absMin % 60).padStart(2, "0");
    const tzSuffix = `${sign}${offH}:${offM}`;
    newScheduledStart = new Date(`${date}T${startTime}:00${tzSuffix}`).toISOString();
    newScheduledFinish = new Date(`${date}T${endTime}:00${tzSuffix}`).toISOString();
  }

  // Determine if reconfirmation needed (using timezone-adjusted ISO strings)
  const needsReconfirmation = shift.status === "accepted" && requiresEmployeeReconfirmation(
    {
      date: shift.date,
      scheduled_start: shift.scheduled_start,
      scheduled_finish: shift.scheduled_finish,
      location: shift.location,
    },
    { date, startTime, endTime, location, scheduledStartISO: newScheduledStart, scheduledFinishISO: newScheduledFinish }
  );

  // Determine new status
  type ShiftStatusType = "pending" | "accepted" | "declined" | "completed" | "cancelled" | "updated_pending";
  let newStatus: ShiftStatusType = shift.status as ShiftStatusType;
  if (needsReconfirmation) {
    newStatus = "updated_pending";
  }

  // Auto-link location_id if location text matches a work_location name
  let locationId: string | null = null;
  if (location) {
    const { data: wl } = await adminClient
      .from("work_locations")
      .select("id")
      .eq("business_id", shift.business_id)
      .ilike("name", location)
      .eq("status", "ACTIVE")
      .limit(1)
      .single();
    if (wl) locationId = wl.id;
  }

  // Update the shift
  const { error: updateError } = await adminClient
    .from("shifts")
    .update({
      date,
      scheduled_start: newScheduledStart,
      scheduled_finish: newScheduledFinish,
      location: location || null,
      location_id: locationId,
      instructions: instructions || null,
      status: newStatus,
      updated_by: ctx.userId,
      last_change_reason: changeReason,
      require_odometer: typeof requireOdometer === "boolean" ? requireOdometer : null,
    })
    .eq("id", shiftId);

  if (updateError) {
    console.error("Shift update error:", updateError);
    return NextResponse.json({ error: "Failed to update shift." }, { status: 500 });
  }

  // Record audit log
  const { error: auditError } = await adminClient
    .from("shift_audit_log")
    .insert({
      shift_id: shiftId,
      employee_id: shift.employee_id,
      business_id: shift.business_id,
      changed_by: ctx.userId,
      original_date: shift.date,
      new_date: date,
      original_start: shift.scheduled_start,
      new_start: newScheduledStart,
      original_finish: shift.scheduled_finish,
      new_finish: newScheduledFinish,
      original_location: shift.location,
      new_location: location || null,
      original_instructions: shift.instructions,
      new_instructions: instructions || null,
      original_status: shift.status,
      new_status: newStatus,
      change_reason: changeReason,
      change_notes: changeNotes || null,
      override_reason: overrideReason || null,
      required_reconfirmation: needsReconfirmation,
    });

  if (auditError) {
    console.error("Audit log error:", auditError);
    // Don't fail the whole update for audit log errors
  }

  return NextResponse.json({
    success: true,
    status: newStatus,
    needsReconfirmation,
    message: needsReconfirmation
      ? "Shift updated. Employee will need to reconfirm."
      : "Shift updated successfully.",
  });
}
