// GET /api/payroll/history — employee payroll history (or admin view of all)
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(request: Request) {
  try {
    const ctx = await requireMember();
    const adminClient = createAdminClient();
    const url = new URL(request.url);

    const employeeId = url.searchParams.get("employeeId");
    const limit = parseInt(url.searchParams.get("limit") || "20");

    // For employees: only show their own pay period items
    if (ctx.role === "EMPLOYEE") {
      if (!ctx.employeeId) return NextResponse.json([]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (adminClient as any)
        .from("pay_period_items")
        .select("*, pay_periods ( id, period_start, period_end, status, frequency, paid_at )")
        .eq("employee_id", ctx.employeeId)
        .eq("business_id", ctx.businessId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // Format for employee view
      const history = (data || []).map((item: {
        pay_periods: { period_start: string; period_end: string; status: string; paid_at: string | null };
        ordinary_hours: number;
        total_mileage_km: number;
        adjustments_total: number;
        total_payable: number;
        payment_status: string;
        paid_at: string | null;
      }) => ({
        payPeriod: `${item.pay_periods.period_start} – ${item.pay_periods.period_end}`,
        periodStatus: item.pay_periods.status,
        hours: item.ordinary_hours,
        mileage: item.total_mileage_km,
        adjustments: item.adjustments_total,
        total: item.total_payable,
        paymentStatus: item.payment_status,
        paidAt: item.paid_at || item.pay_periods.paid_at,
      }));

      return NextResponse.json(history);
    }

    // Admin view: all pay periods with summary
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (adminClient as any)
      .from("pay_periods")
      .select("*")
      .eq("business_id", ctx.businessId)
      .order("period_start", { ascending: false })
      .limit(limit);

    if (employeeId) {
      // Show periods that have items for this employee
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: empItems } = await (adminClient as any)
        .from("pay_period_items")
        .select("pay_period_id, ordinary_hours, total_payable, payment_status, paid_at, pay_periods ( period_start, period_end, status, frequency, paid_at )")
        .eq("employee_id", employeeId)
        .eq("business_id", ctx.businessId)
        .order("created_at", { ascending: false })
        .limit(limit);

      return NextResponse.json(empItems || []);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data || []);
  } catch (err) {
    return handleTenantError(err);
  }
}
