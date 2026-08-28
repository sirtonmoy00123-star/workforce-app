// GET /api/dashboard/employee — stats for employee dashboard
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, handleTenantError } from "@/lib/services/tenantContext";

export async function GET() {
  try {
    const ctx = await requireRole("EMPLOYEE");

    if (!ctx.employeeId) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const adminClient = createAdminClient();

    // Upcoming shifts (pending or accepted, future dates)
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const { data: upcomingShifts } = await adminClient
      .from("shifts")
      .select("id, date, scheduled_start, scheduled_finish, location, status")
      .eq("employee_id", ctx.employeeId)
      .in("status", ["pending", "accepted"])
      .gte("date", todayStr)
      .order("date", { ascending: true })
      .limit(5);

    // Active shift (working right now) — read from work_sessions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: activeAttendance } = await (adminClient as any)
      .from("work_sessions")
      .select("*, shifts!inner(id, date, scheduled_start, scheduled_finish, location)")
      .eq("employee_id", ctx.employeeId)
      .eq("status", "working")
      .limit(1);

    // Recent timesheets
    const { data: recentTimesheets } = await adminClient
      .from("timesheets")
      .select("id, actual_start, worked_minutes, total_amount, status")
      .eq("employee_id", ctx.employeeId)
      .order("created_at", { ascending: false })
      .limit(3);

    // Payment stats
    const { data: payments } = await adminClient
      .from("payments")
      .select("total_amount, status")
      .eq("employee_id", ctx.employeeId);

    const totalEarned = payments?.reduce((sum, p) => sum + p.total_amount, 0) || 0;
    const totalPaid = payments?.filter((p) => p.status === "paid").reduce((sum, p) => sum + p.total_amount, 0) || 0;
    const pendingPayment = totalEarned - totalPaid;

    // Get employee name
    const { data: employee } = await adminClient
      .from("employees")
      .select("full_name")
      .eq("id", ctx.employeeId)
      .single();

    return NextResponse.json({
      employeeName: employee?.full_name || "",
      upcomingShifts: upcomingShifts || [],
      activeShift: activeAttendance && activeAttendance.length > 0 ? activeAttendance[0] : null,
      recentTimesheets: recentTimesheets || [],
      totalEarned,
      totalPaid,
      pendingPayment,
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
