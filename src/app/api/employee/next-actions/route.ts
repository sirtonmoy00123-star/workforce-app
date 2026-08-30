// GET /api/employee/next-actions — get smart actions for employee's shifts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, handleTenantError } from "@/lib/services/tenantContext";
import { getNextShiftAction, ShiftState } from "@/lib/services/nextAction";
import { utcToLocal, getBusinessTimezone } from "@/lib/calculations/timezone";

export async function GET() {
  try {
    const ctx = await requireRole("EMPLOYEE");
    if (!ctx.employeeId) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const adminClient = createAdminClient();
    const tz = await getBusinessTimezone(ctx.businessId);
    const todayStr = utcToLocal(new Date().toISOString(), tz).date;

    // Fetch active/upcoming shifts with related data in parallel
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ac = adminClient as any;
    const [shiftsResult, workSessionsResult, attendanceResult, timesheetsResult] = await Promise.all([
      // Shifts: today and future, not cancelled/declined
      ac
        .from("shifts")
        .select("id, date, scheduled_start, scheduled_finish, location, status, require_odometer")
        .eq("employee_id", ctx.employeeId)
        .gte("date", todayStr)
        .not("status", "in", '("cancelled","declined","draft")')
        .order("date", { ascending: true })
        .order("scheduled_start", { ascending: true })
        .limit(10),

      // Active work sessions
      ac
        .from("work_sessions")
        .select("id, shift_id, status")
        .eq("employee_id", ctx.employeeId)
        .in("status", ["working", "finished"]),

      // Attendance records for today
      ac
        .from("attendance_records")
        .select("id, shift_id, actual_checkin, actual_checkout")
        .eq("employee_id", ctx.employeeId)
        .gte("created_at", todayStr),

      // Recent timesheets for these shifts
      ac
        .from("timesheets")
        .select("id, shift_id, status")
        .eq("employee_id", ctx.employeeId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    const shifts = shiftsResult.data || [];
    const workSessions = workSessionsResult.data || [];
    const attendance = attendanceResult.data || [];
    const timesheets = timesheetsResult.data || [];

    // Build ShiftState for each shift
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shiftActions = shifts.map((shift: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ws = workSessions.find((w: any) => w.shift_id === shift.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const att = attendance.find((a: any) => a.shift_id === shift.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ts = timesheets.find((t: any) => t.shift_id === shift.id);

      const state: ShiftState = {
        shiftId: shift.id,
        status: shift.status,
        date: shift.date,
        scheduledStart: shift.scheduled_start,
        scheduledFinish: shift.scheduled_finish,
        hasWorkSession: !!ws,
        workSessionStatus: ws?.status,
        hasCheckin: !!att?.actual_checkin,
        hasCheckout: !!att?.actual_checkout,
        requiresCheckin: false, // Derived from attendance config when available
        requiresCheckout: false,
        requiresTaskProof: false, // Derived from task_proof_requirements if present
        hasTaskProof: false,
        taskProofStatus: undefined,
        timesheetId: ts?.id,
        timesheetStatus: ts?.status,
      };

      const action = getNextShiftAction(state);

      return {
        shiftId: shift.id,
        date: shift.date,
        scheduledStart: shift.scheduled_start,
        scheduledFinish: shift.scheduled_finish,
        location: shift.location,
        status: shift.status,
        isToday: shift.date === todayStr,
        action,
      };
    });

    // Split into today / upcoming / past-today-completed
    const todayShifts = shiftActions.filter((s: { isToday: boolean }) => s.isToday);
    const upcomingShifts = shiftActions.filter((s: { isToday: boolean }) => !s.isToday);

    return NextResponse.json({
      today: todayShifts,
      upcoming: upcomingShifts,
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
