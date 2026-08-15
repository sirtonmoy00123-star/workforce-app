// GET /api/shifts/[id] — get single shift details
// PUT /api/shifts/[id] — accept/decline (employee) OR preview/update (admin edit)
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  validateShiftAssignment,
  requiresEmployeeReconfirmation,
  type ShiftAssignmentInput,
  type EmployeeData,
  type AvailabilityData,
  type ExistingShiftData,
  type AttendanceData,
} from "@/lib/services/shiftValidation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { data: appUser } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", user.id)
      .single();
    if (!appUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const adminClient = createAdminClient();
    const { data: shift, error } = await adminClient
      .from("shifts")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !shift) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }

    // Verify access: admin must be same business, employee must own the shift
    if (appUser.role === "admin") {
      if (shift.business_id !== appUser.business_id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      const { data: emp } = await supabase
        .from("employees")
        .select("id")
        .eq("user_id", appUser.id)
        .single();
      if (!emp || shift.employee_id !== emp.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Also get employee name for display
    const { data: employee } = await adminClient
      .from("employees")
      .select("full_name, employee_number")
      .eq("id", shift.employee_id)
      .single();

    // Get attendance status if exists
    const { data: attendance } = await adminClient
      .from("shift_attendance")
      .select("attendance_status, actual_start, actual_finish")
      .eq("shift_id", id)
      .eq("employee_id", shift.employee_id)
      .maybeSingle();

    return NextResponse.json({ ...shift, employee, attendance });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { data: appUser } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", user.id)
      .single();
    if (!appUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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

    // ── Employee actions: accept / decline / accept_updated ──
    if (appUser.role === "employee") {
      const { data: emp } = await supabase
        .from("employees")
        .select("id")
        .eq("user_id", appUser.id)
        .single();

      if (!emp || shift.employee_id !== emp.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      if (action === "accept" || action === "accept_updated") {
        if (shift.status !== "pending" && shift.status !== "updated_pending") {
          return NextResponse.json({ error: "Only pending or updated shifts can be accepted." }, { status: 400 });
        }
        const { error } = await adminClient
          .from("shifts")
          .update({ status: "accepted" })
          .eq("id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, status: "accepted" });
      }

      if (action === "decline") {
        if (shift.status !== "pending" && shift.status !== "updated_pending") {
          return NextResponse.json({ error: "Only pending or updated shifts can be declined." }, { status: 400 });
        }
        const { error } = await adminClient
          .from("shifts")
          .update({ status: "declined" })
          .eq("id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, status: "declined" });
      }

      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // ── Admin actions: preview_edit / update_shift ──
    if (appUser.role === "admin") {
      if (shift.business_id !== appUser.business_id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      if (action === "preview_edit") {
        return handlePreviewEdit(id, body, shift, adminClient);
      }

      if (action === "update_shift") {
        return handleUpdateShift(id, body, shift, appUser, adminClient);
      }

      // Legacy: admin could also accept/decline on behalf (not used in current UI)
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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

  // Fetch existing shifts for overlap check
  const { data: existingShifts } = await adminClient
    .from("shifts")
    .select("id, employee_id, date, scheduled_start, scheduled_finish, status")
    .eq("employee_id", shift.employee_id)
    .eq("date", date);

  // Fetch attendance
  const { data: attendance } = await adminClient
    .from("shift_attendance")
    .select("shift_id, attendance_status")
    .eq("shift_id", shiftId)
    .eq("employee_id", shift.employee_id)
    .maybeSingle();

  const input: ShiftAssignmentInput = {
    employeeId: shift.employee_id,
    date,
    startTime,
    endTime,
    location,
    instructions,
    excludeShiftId: shiftId,
  };

  const result = validateShiftAssignment(
    input,
    employee as EmployeeData,
    availability as AvailabilityData | null,
    (existingShifts || []) as ExistingShiftData[],
    attendance as AttendanceData | null,
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
async function handleUpdateShift(shiftId: string, body: any, shift: any, appUser: any, adminClient: any) {
  const { date, startTime, endTime, location, instructions, changeReason, changeNotes, overrideReason } = body;

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

  const { data: existingShifts } = await adminClient
    .from("shifts")
    .select("id, employee_id, date, scheduled_start, scheduled_finish, status")
    .eq("employee_id", shift.employee_id)
    .eq("date", date);

  const { data: attendance } = await adminClient
    .from("shift_attendance")
    .select("shift_id, attendance_status")
    .eq("shift_id", shiftId)
    .eq("employee_id", shift.employee_id)
    .maybeSingle();

  const input: ShiftAssignmentInput = {
    employeeId: shift.employee_id,
    date,
    startTime,
    endTime,
    location,
    instructions,
    excludeShiftId: shiftId,
  };

  const result = validateShiftAssignment(
    input,
    employee as EmployeeData,
    availability as AvailabilityData | null,
    (existingShifts || []) as ExistingShiftData[],
    attendance as AttendanceData | null,
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

  // Determine if reconfirmation needed
  const needsReconfirmation = shift.status === "accepted" && requiresEmployeeReconfirmation(
    {
      date: shift.date,
      scheduled_start: shift.scheduled_start,
      scheduled_finish: shift.scheduled_finish,
      location: shift.location,
    },
    { date, startTime, endTime, location }
  );

  // Build new timestamps
  const newScheduledStart = new Date(`${date}T${startTime}:00`).toISOString();
  const newScheduledFinish = new Date(`${date}T${endTime}:00`).toISOString();

  // Determine new status
  type ShiftStatusType = "pending" | "accepted" | "declined" | "completed" | "cancelled" | "updated_pending";
  let newStatus: ShiftStatusType = shift.status as ShiftStatusType;
  if (needsReconfirmation) {
    newStatus = "updated_pending";
  }

  // Update the shift
  const { error: updateError } = await adminClient
    .from("shifts")
    .update({
      date,
      scheduled_start: newScheduledStart,
      scheduled_finish: newScheduledFinish,
      location: location || null,
      instructions: instructions || null,
      status: newStatus,
      updated_by: appUser.id,
      last_change_reason: changeReason,
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
      changed_by: appUser.id,
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
