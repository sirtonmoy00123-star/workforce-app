// GET /api/payroll/[id]/adjustments — list adjustments for a pay period
// POST /api/payroll/[id]/adjustments — create an adjustment
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (adminClient as any)
      .from("payroll_adjustments")
      .select("*, employees ( full_name, employee_number )")
      .eq("pay_period_id", id)
      .eq("business_id", ctx.businessId)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data || []);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();
    const body = await request.json();

    const { employeeId, adjustmentType, amount, reason } = body;

    if (!employeeId || !adjustmentType || amount === undefined || !reason) {
      return NextResponse.json(
        { error: "employeeId, adjustmentType, amount, and reason are required." },
        { status: 400 }
      );
    }

    const validTypes = ["BONUS", "ALLOWANCE", "REIMBURSEMENT", "DEDUCTION", "CORRECTION", "OTHER"];
    if (!validTypes.includes(adjustmentType)) {
      return NextResponse.json(
        { error: `adjustmentType must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Verify pay period exists and is not locked/paid
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: payPeriod } = await (adminClient as any)
      .from("pay_periods")
      .select("id, status")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!payPeriod) {
      return NextResponse.json({ error: "Pay period not found." }, { status: 404 });
    }

    if (payPeriod.status === "LOCKED" || payPeriod.status === "PAID") {
      return NextResponse.json(
        { error: `Cannot add adjustments to a ${payPeriod.status} pay period. Reopen it first.` },
        { status: 400 }
      );
    }

    // Verify employee belongs to business
    const { data: emp } = await adminClient
      .from("employees")
      .select("id")
      .eq("id", employeeId)
      .eq("business_id", ctx.businessId)
      .single();

    if (!emp) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    // Create adjustment
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: adjustment, error } = await (adminClient as any)
      .from("payroll_adjustments")
      .insert({
        pay_period_id: id,
        employee_id: employeeId,
        business_id: ctx.businessId,
        adjustment_type: adjustmentType,
        amount: parseFloat(amount),
        reason,
        created_by: ctx.userId,
      })
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, adjustment });
  } catch (err) {
    return handleTenantError(err);
  }
}
