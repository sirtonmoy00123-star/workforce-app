// GET /api/timesheets/[id] — get single timesheet details
// PUT /api/timesheets/[id] — admin approve/needs_correction
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireMember();
    const adminClient = createAdminClient();

    const { data: timesheet, error } = await adminClient
      .from("timesheets")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !timesheet) {
      return NextResponse.json({ error: "Timesheet not found" }, { status: 404 });
    }

    // Verify business access
    if (timesheet.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Employee can only see their own
    if (ctx.role === "EMPLOYEE" && timesheet.employee_id !== ctx.employeeId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get employee info
    const { data: employee } = await adminClient
      .from("employees")
      .select("id, full_name, employee_number")
      .eq("id", timesheet.employee_id)
      .single();

    // Get odometer submissions for this shift
    const { data: odometerSubmissions } = await adminClient
      .from("odometer_submissions")
      .select("*")
      .eq("shift_id", timesheet.shift_id)
      .order("server_timestamp", { ascending: true });

    // Get shift info (include scheduled times and shift_attendance)
    const { data: shift } = await adminClient
      .from("shifts")
      .select("location, instructions, scheduled_start, scheduled_finish")
      .eq("id", timesheet.shift_id)
      .single();

    // Get work session record (actual work start/finish)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shiftAttendance } = await (adminClient as any)
      .from("work_sessions")
      .select("actual_start_at, actual_finish_at, status")
      .eq("shift_id", timesheet.shift_id)
      .maybeSingle();

    // Get attendance record for this shift (check-in/out verification)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: attendanceRecord } = await adminClient
      .from("attendance_records")
      .select(
        "id, checkin_status, checkout_status, actual_checkin, actual_checkout, " +
        "qr_verified, checkin_distance_metres, checkout_distance_metres, " +
        "selfie_photo_path, site_photo_path, verification_status, requires_review, " +
        "approved_start, approved_finish, reviewed_at, review_note"
      )
      .eq("shift_id", timesheet.shift_id)
      .eq("business_id", ctx.businessId)
      .maybeSingle() as { data: Record<string, unknown> | null };

    // Get attendance exceptions if attendance record exists
    let attendanceExceptions: { id: string; exception_type: string; difference_minutes: number | null; difference_metres: number | null; status: string }[] = [];
    if (attendanceRecord) {
      const { data: exceptions } = await adminClient
        .from("attendance_exceptions")
        .select("id, exception_type, difference_minutes, difference_metres, status")
        .eq("attendance_record_id", attendanceRecord.id as string);
      attendanceExceptions = exceptions || [];
    }

    return NextResponse.json({
      ...timesheet,
      employee: employee ? { full_name: employee.full_name, employee_number: employee.employee_number } : null,
      odometer_submissions: odometerSubmissions || [],
      shift_location: shift?.location || null,
      shift_scheduled_start: shift?.scheduled_start || null,
      shift_scheduled_finish: shift?.scheduled_finish || null,
      shift_work_start: shiftAttendance?.actual_start_at || null,
      shift_work_finish: shiftAttendance?.actual_finish_at || null,
      attendance: attendanceRecord ? {
        ...attendanceRecord,
        exceptions: attendanceExceptions,
      } : null,
    });
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
    const ctx = await requireAdmin();

    const body = await request.json();
    const { action, approved_total } = body; // action: "approve" | "needs_correction"

    const adminClient = createAdminClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: timesheet } = await adminClient
      .from("timesheets")
      .select("*")
      .eq("id", id)
      .single() as { data: any };

    if (!timesheet) {
      return NextResponse.json({ error: "Timesheet not found" }, { status: 404 });
    }

    // Verify business access
    if (timesheet.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (action === "approve") {
      const finalTotal = approved_total !== undefined ? approved_total : timesheet.total_amount;

      const { error } = await adminClient
        .from("timesheets")
        .update({
          status: "approved",
          approved_total: finalTotal,
          approved_by: ctx.userId,
          approved_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // If there's a pending or submitted correction, mark it approved too
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (adminClient as any)
        .from("timesheet_corrections")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("timesheet_id", id)
        .in("status", ["pending", "submitted"]);

      return NextResponse.json({ success: true, status: "approved" });
    }

    if (action === "needs_correction") {
      const { error } = await adminClient
        .from("timesheets")
        .update({
          status: "needs_correction",
          approved_by: ctx.userId,
          approved_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, status: "needs_correction" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return handleTenantError(err);
  }
}
