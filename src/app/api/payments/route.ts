// GET /api/payments — list payments
// POST /api/payments — create payment from approved timesheets for an employee+period
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(_request: NextRequest) {
  try {
    const ctx = await requireMember();
    const adminClient = createAdminClient();

    if (ctx.role === "OWNER" || ctx.role === "ADMIN") {
      // Get all employees in this business
      const { data: employees } = await adminClient
        .from("employees")
        .select("id, full_name, employee_number")
        .eq("business_id", ctx.businessId);

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
      if (!ctx.employeeId) return NextResponse.json([]);

      const { data: payments, error } = await adminClient
        .from("payments")
        .select("*")
        .eq("employee_id", ctx.employeeId)
        .order("created_at", { ascending: false });

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(payments || []);
    }
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAdmin();

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
      .eq("business_id", ctx.businessId)
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
    // Use approved_total (admin may have adjusted) — fall back to total_amount
    let totalMinutes = 0;
    let totalMileage = 0;
    let totalWages = 0;
    let totalMileageAmount = 0;
    let totalAmount = 0;

    for (const ts of timesheets) {
      totalMinutes += ts.worked_minutes;
      totalMileage += ts.distance_km;
      totalWages += ts.wage_amount;
      totalMileageAmount += ts.mileage_amount;
      totalAmount += ts.approved_total ?? ts.total_amount;
    }

    const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
    totalAmount = Math.round(totalAmount * 100) / 100;

    // Check that none of these timesheets are already linked to a payment
    const timesheetIds = timesheets.map((ts) => ts.id);
    // payment_id is not in generated Supabase types yet (added in migration 018)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingPaymentLinks } = await (adminClient as any)
      .from("timesheets")
      .select("id, payment_id")
      .in("id", timesheetIds)
      .not("payment_id", "is", null);

    if (existingPaymentLinks && existingPaymentLinks.length > 0) {
      return NextResponse.json(
        { error: `${existingPaymentLinks.length} timesheet(s) are already linked to another payment.` },
        { status: 400 }
      );
    }

    const { data: payment, error } = await adminClient
      .from("payments")
      .insert({
        employee_id,
        business_id: ctx.businessId,
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

    // Link timesheets to the payment to prevent double-counting
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminClient as any)
      .from("timesheets")
      .update({ payment_id: payment.id })
      .in("id", timesheetIds);

    return NextResponse.json(payment);
  } catch (err) {
    return handleTenantError(err);
  }
}
