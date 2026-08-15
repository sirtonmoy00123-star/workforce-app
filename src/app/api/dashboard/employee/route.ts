// GET /api/dashboard/employee — stats for employee dashboard
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { data: appUser } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", user.id)
      .single();
    if (!appUser || appUser.role !== "employee") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: employee } = await supabase
      .from("employees")
      .select("*")
      .eq("user_id", appUser.id)
      .single();
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const adminClient = createAdminClient();

    // Upcoming shifts (pending or accepted, future dates)
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    const { data: upcomingShifts } = await adminClient
      .from("shifts")
      .select("id, date, scheduled_start, scheduled_finish, location, status")
      .eq("employee_id", employee.id)
      .in("status", ["pending", "accepted"])
      .gte("date", todayStr)
      .order("date", { ascending: true })
      .limit(5);

    // Active shift (working right now)
    const { data: activeAttendance } = await adminClient
      .from("shift_attendance")
      .select("*, shifts!inner(id, date, scheduled_start, scheduled_finish, location)")
      .eq("employee_id", employee.id)
      .eq("attendance_status", "working")
      .limit(1);

    // Recent timesheets
    const { data: recentTimesheets } = await adminClient
      .from("timesheets")
      .select("id, actual_start, worked_minutes, estimated_total, status")
      .eq("employee_id", employee.id)
      .order("created_at", { ascending: false })
      .limit(3);

    // Payment stats
    const { data: payments } = await adminClient
      .from("payments")
      .select("total_amount, status")
      .eq("employee_id", employee.id);

    const totalEarned = payments?.reduce((sum, p) => sum + p.total_amount, 0) || 0;
    const totalPaid = payments?.filter((p) => p.status === "paid").reduce((sum, p) => sum + p.total_amount, 0) || 0;
    const pendingPayment = totalEarned - totalPaid;

    return NextResponse.json({
      employeeName: employee.full_name,
      upcomingShifts: upcomingShifts || [],
      activeShift: activeAttendance && activeAttendance.length > 0 ? activeAttendance[0] : null,
      recentTimesheets: recentTimesheets || [],
      totalEarned,
      totalPaid,
      pendingPayment,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
