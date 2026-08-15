// GET /api/timesheets — list timesheets
// Admin sees all timesheets for their business, Employee sees only their own
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  try {
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
    const searchParams = request.nextUrl.searchParams;
    const statusFilter = searchParams.get("status") as "submitted" | "approved" | "needs_correction" | null;

    if (appUser.role === "admin") {
      // Admin: get all timesheets for employees in their business
      // First get all employee IDs in this business
      const { data: employees } = await adminClient
        .from("employees")
        .select("id, full_name, employee_number")
        .eq("business_id", appUser.business_id);

      if (!employees || employees.length === 0) {
        return NextResponse.json([]);
      }

      const employeeIds = employees.map((e) => e.id);
      const employeeMap = Object.fromEntries(employees.map((e) => [e.id, e]));

      let query = adminClient
        .from("timesheets")
        .select("*")
        .in("employee_id", employeeIds)
        .order("created_at", { ascending: false });

      if (statusFilter) {
        query = query.eq("status", statusFilter);
      }

      const { data: timesheets, error } = await query;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // Attach employee info to each timesheet
      const result = (timesheets || []).map((ts) => ({
        ...ts,
        employee: employeeMap[ts.employee_id] || null,
      }));

      return NextResponse.json(result);
    } else {
      // Employee: get their own timesheets
      const { data: employee } = await supabase
        .from("employees")
        .select("id")
        .eq("user_id", appUser.id)
        .single();

      if (!employee) return NextResponse.json([]);

      let query = adminClient
        .from("timesheets")
        .select("*")
        .eq("employee_id", employee.id)
        .order("created_at", { ascending: false });

      if (statusFilter) {
        query = query.eq("status", statusFilter);
      }

      const { data: timesheets, error } = await query;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      return NextResponse.json(timesheets || []);
    }
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
