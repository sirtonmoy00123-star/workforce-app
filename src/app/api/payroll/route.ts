// GET /api/payroll — list pay periods
// POST /api/payroll — create a pay period
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, requireMember, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(request: Request) {
  try {
    const ctx = await requireMember();
    const adminClient = createAdminClient();
    const url = new URL(request.url);

    const status = url.searchParams.get("status");
    const limit = parseInt(url.searchParams.get("limit") || "20");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (adminClient as any)
      .from("pay_periods")
      .select("*")
      .eq("business_id", ctx.businessId)
      .order("period_start", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data || []);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();
    const body = await request.json();

    const { periodStart, periodEnd, frequency } = body;

    if (!periodStart || !periodEnd) {
      return NextResponse.json({ error: "periodStart and periodEnd are required." }, { status: 400 });
    }

    if (periodEnd < periodStart) {
      return NextResponse.json({ error: "periodEnd must be on or after periodStart." }, { status: 400 });
    }

    const validFrequencies = ["WEEKLY", "FORTNIGHTLY", "MONTHLY", "CUSTOM"];
    const freq = frequency || "WEEKLY";
    if (!validFrequencies.includes(freq)) {
      return NextResponse.json({ error: `Invalid frequency. Must be one of: ${validFrequencies.join(", ")}` }, { status: 400 });
    }

    // Check for overlapping pay periods
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: overlap } = await (adminClient as any)
      .from("pay_periods")
      .select("id, period_start, period_end, status")
      .eq("business_id", ctx.businessId)
      .lte("period_start", periodEnd)
      .gte("period_end", periodStart)
      .not("status", "eq", "PAID");

    if (overlap && overlap.length > 0) {
      return NextResponse.json({
        error: "Overlapping active pay period exists.",
        existing: overlap,
      }, { status: 409 });
    }

    // Create pay period
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: payPeriod, error } = await (adminClient as any)
      .from("pay_periods")
      .insert({
        business_id: ctx.businessId,
        period_start: periodStart,
        period_end: periodEnd,
        frequency: freq,
        status: "DRAFT",
      })
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Auto-link approved timesheets in this period that aren't already linked
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: timesheets } = await (adminClient as any)
      .from("timesheets")
      .select("id, employee_id")
      .eq("business_id", ctx.businessId)
      .eq("status", "approved")
      .is("pay_period_id", null)
      .gte("period_start", periodStart)
      .lte("period_end", periodEnd);

    if (timesheets && timesheets.length > 0) {
      const tsIds = timesheets.map((t: { id: string }) => t.id);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (adminClient as any)
        .from("timesheets")
        .update({ pay_period_id: payPeriod.id })
        .in("id", tsIds);
    }

    // Audit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminClient as any).from("payroll_audit_log").insert({
      pay_period_id: payPeriod.id,
      business_id: ctx.businessId,
      action: "CREATED",
      new_status: "DRAFT",
      performed_by: ctx.userId,
      metadata: { period_start: periodStart, period_end: periodEnd, frequency: freq },
    });

    return NextResponse.json({ success: true, payPeriod });
  } catch (err) {
    return handleTenantError(err);
  }
}
