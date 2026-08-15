// GET /api/dashboard/admin — stats for admin dashboard
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
    if (!appUser || appUser.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const adminClient = createAdminClient();
    const businessId = appUser.business_id;

    // Get all employees
    const { data: employees } = await adminClient
      .from("employees")
      .select("id, employment_status")
      .eq("business_id", businessId);

    const totalEmployees = employees?.length || 0;
    const activeEmployees = employees?.filter((e) => e.employment_status === "active").length || 0;
    const employeeIds = employees?.map((e) => e.id) || [];

    // Pending shifts (status = pending)
    const { count: pendingShifts } = await adminClient
      .from("shifts")
      .select("*", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "pending");

    // Today's shifts
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const { count: todayShifts } = await adminClient
      .from("shifts")
      .select("*", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("date", todayStr);

    // Submitted timesheets (awaiting review)
    let submittedTimesheets = 0;
    if (employeeIds.length > 0) {
      const { count } = await adminClient
        .from("timesheets")
        .select("*", { count: "exact", head: true })
        .in("employee_id", employeeIds)
        .eq("status", "submitted");
      submittedTimesheets = count || 0;
    }

    // Unpaid payments
    let unpaidPayments = 0;
    let unpaidAmount = 0;
    if (employeeIds.length > 0) {
      const { data: unpaid } = await adminClient
        .from("payments")
        .select("total_amount")
        .in("employee_id", employeeIds)
        .eq("status", "unpaid");
      unpaidPayments = unpaid?.length || 0;
      unpaidAmount = unpaid?.reduce((sum, p) => sum + p.total_amount, 0) || 0;
    }

    return NextResponse.json({
      totalEmployees,
      activeEmployees,
      pendingShifts: pendingShifts || 0,
      todayShifts: todayShifts || 0,
      submittedTimesheets,
      unpaidPayments,
      unpaidAmount,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
