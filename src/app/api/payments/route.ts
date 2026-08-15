// GET /api/payments — list payments
// POST /api/payments — create payment from approved timesheets for an employee+period
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

    if (appUser.role === "admin") {
      // Get all employees in this business
      const { data: employees } = await adminClient
        .from("employees")
        .select("id, full_name, employee_number")
        .eq("business_id", appUser.business_id);

      if (!employees || employees.length === 0) return NextResponse.json([]);

      const employeeIds = employees.map((e) => e.id);
      const employeeMap = Object.fromEntries(employees.map((e) => [e.id, e]));

      const { data: payments, error } = await adminClient
        .from("payments")
        .select("*")
        .in("employee_id", employeeIds)
        .order("created_at", { ascending: false });

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const result = (payments || []).map((p) => ({
        ...p,
        employee: employeeMap[p.employee_id] || null,
      }));

      return NextResponse.json(result);
    } else {
      // Employee sees their own
      const { data: employee } = await supabase
        .from("employees")
        .select("id")
        .eq("user_id", appUser.id)
        .single();

      if (!employee) return NextResponse.json([]);

      const { data: payments, error } = await adminClient
        .from("payments")
        .select("*")
        .eq("employee_id", employee.id)
        .order("created_at", { ascending: false });

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(payments || []);
    }
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
      return NextResponse.json({ error: "Only admins can create payments." }, { status: 403 });
    }

    const body = await request.json();
    const { employee_id, period_start, period_end } = body;

    if (!employee_id || !period_start || !period_end) {
      return NextResponse.json({ error: "employee_id, period_start, and period_end are required." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Verify employee belongs to this business
    const { data: employee } = await adminClient
      .from("employees")
      .select("*")
      .eq("id", employee_id)
      .eq("business_id", appUser.business_id)
      .single();

    if (!employee) {
      return NextResponse.json({ error: "Employee not found in your business." }, { status: 404 });
    }

    // Get approved timesheets for this employee in the date range
    const { data: timesheets } = await adminClient
      .from("timesheets")
      .select("*")
      .eq("employee_id", employee_id)
      .eq("status", "approved")
      .gte("actual_start", period_start + "T00:00:00Z")
      .lte("actual_start", period_end + "T23:59:59Z");

    if (!timesheets || timesheets.length === 0) {
      return NextResponse.json({ error: "No approved timesheets found for this period." }, { status: 400 });
    }

    // Calculate totals from approved timesheets
    let totalMinutes = 0;
    let totalMileage = 0;
    let totalWages = 0;
    let totalMileageAmount = 0;

    for (const ts of timesheets) {
      totalMinutes += ts.worked_minutes;
      totalMileage += ts.distance_km;
      totalWages += ts.wage_amount;
      totalMileageAmount += ts.mileage_amount;
    }

    const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
    const totalAmount = Math.round((totalWages + totalMileageAmount) * 100) / 100;

    const { data: payment, error } = await adminClient
      .from("payments")
      .insert({
        employee_id,
        period_start,
        period_end,
        total_hours: totalHours,
        total_mileage: totalMileage,
        wage_amount: Math.round(totalWages * 100) / 100,
        mileage_amount: Math.round(totalMileageAmount * 100) / 100,
        total_amount: totalAmount,
        status: "unpaid",
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(payment);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
