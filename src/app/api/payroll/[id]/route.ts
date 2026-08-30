// GET /api/payroll/[id] — get pay period detail with items + timesheets
// PATCH /api/payroll/[id] — update pay period status (review, approve, etc.)
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, requireMember, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireMember();
    const adminClient = createAdminClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: payPeriod, error } = await (adminClient as any)
      .from("pay_periods")
      .select("*")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (error || !payPeriod) {
      return NextResponse.json({ error: "Pay period not found." }, { status: 404 });
    }

    // Get pay period items (employee summaries)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: items } = await (adminClient as any)
      .from("pay_period_items")
      .select("*, employees ( full_name, employee_number )")
      .eq("pay_period_id", id)
      .eq("business_id", ctx.businessId);

    // Get linked timesheets
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: timesheets } = await (adminClient as any)
      .from("timesheets")
      .select("*, employees ( full_name, employee_number )")
      .eq("pay_period_id", id)
      .eq("business_id", ctx.businessId)
      .order("period_start");

    // Get adjustments
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: adjustments } = await (adminClient as any)
      .from("payroll_adjustments")
      .select("*, employees ( full_name, employee_number )")
      .eq("pay_period_id", id)
      .eq("business_id", ctx.businessId);

    // Count missing approvals
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count: missingApprovals } = await (adminClient as any)
      .from("timesheets")
      .select("id", { count: "exact", head: true })
      .eq("business_id", ctx.businessId)
      .is("pay_period_id", null)
      .neq("status", "approved")
      .gte("period_start", payPeriod.period_start)
      .lte("period_end", payPeriod.period_end);

    // Employee-only: filter to own data
    if (ctx.role === "EMPLOYEE") {
      const empItems = (items || []).filter((i: { employee_id: string }) => i.employee_id === ctx.employeeId);
      const empTimesheets = (timesheets || []).filter((t: { employee_id: string }) => t.employee_id === ctx.employeeId);
      const empAdj = (adjustments || []).filter((a: { employee_id: string }) => a.employee_id === ctx.employeeId);
      return NextResponse.json({
        ...payPeriod,
        items: empItems,
        timesheets: empTimesheets,
        adjustments: empAdj,
      });
    }

    return NextResponse.json({
      ...payPeriod,
      items: items || [],
      timesheets: timesheets || [],
      adjustments: adjustments || [],
      missingApprovals: missingApprovals || 0,
    });
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();
    const body = await request.json();

    const { status, reason } = body;

    const validStatuses = ["DRAFT", "READY_FOR_REVIEW", "APPROVED", "LOCKED", "PAID", "REOPENED"];
    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json({ error: `Status must be one of: ${validStatuses.join(", ")}` }, { status: 400 });
    }

    // Fetch current pay period
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: current } = await (adminClient as any)
      .from("pay_periods")
      .select("*")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!current) {
      return NextResponse.json({ error: "Pay period not found." }, { status: 404 });
    }

    // Validate state transitions
    const validTransitions: Record<string, string[]> = {
      DRAFT: ["READY_FOR_REVIEW"],
      READY_FOR_REVIEW: ["APPROVED", "DRAFT"],
      APPROVED: ["LOCKED", "DRAFT"],
      LOCKED: ["PAID", "REOPENED"],
      PAID: [],
      REOPENED: ["APPROVED", "LOCKED"],
    };

    const allowed = validTransitions[current.status] || [];
    if (!allowed.includes(status)) {
      return NextResponse.json({
        error: `Cannot transition from ${current.status} to ${status}. Allowed: ${allowed.join(", ") || "none"}`,
      }, { status: 400 });
    }

    // REOPENED requires a reason
    if (status === "REOPENED" && !reason) {
      return NextResponse.json({ error: "Reason is required to reopen payroll." }, { status: 400 });
    }

    // Build update payload
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatePayload: any = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === "APPROVED") {
      updatePayload.approved_at = new Date().toISOString();
      updatePayload.approved_by = ctx.userId;
    }

    if (status === "LOCKED") {
      updatePayload.locked_at = new Date().toISOString();
      updatePayload.locked_by = ctx.userId;

      // Freeze totals — calculate from timesheets + adjustments
      const frozen = await freezePayrollTotals(adminClient, id, ctx.businessId);
      Object.assign(updatePayload, frozen);
    }

    if (status === "PAID") {
      updatePayload.paid_at = new Date().toISOString();
    }

    // Update pay period
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error } = await (adminClient as any)
      .from("pay_periods")
      .update(updatePayload)
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Audit log
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminClient as any).from("payroll_audit_log").insert({
      pay_period_id: id,
      business_id: ctx.businessId,
      action: status === "REOPENED" ? "REOPENED" : `STATUS_CHANGE`,
      reason: reason || null,
      previous_status: current.status,
      new_status: status,
      performed_by: ctx.userId,
    });

    return NextResponse.json({ success: true, payPeriod: updated });
  } catch (err) {
    return handleTenantError(err);
  }
}

/**
 * Freeze payroll totals: calculate from timesheets + adjustments,
 * create/update pay_period_items per employee.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function freezePayrollTotals(adminClient: any, payPeriodId: string, businessId: string) {
  // Get all linked timesheets
  const { data: timesheets } = await adminClient
    .from("timesheets")
    .select("*")
    .eq("pay_period_id", payPeriodId)
    .eq("business_id", businessId)
    .eq("status", "approved");

  // Get adjustments
  const { data: adjustments } = await (adminClient as any)
    .from("payroll_adjustments")
    .select("*")
    .eq("pay_period_id", payPeriodId)
    .eq("business_id", businessId);

  // Aggregate per employee
  const empData: Record<string, {
    ordinary_hours: number;
    payable_minutes: number;
    total_mileage_km: number;
    hourly_rate: number;
    mileage_rate: number;
    wages: number;
    mileage_payment: number;
    adjustments_total: number;
  }> = {};

  for (const ts of timesheets || []) {
    if (!empData[ts.employee_id]) {
      empData[ts.employee_id] = {
        ordinary_hours: 0,
        payable_minutes: 0,
        total_mileage_km: 0,
        hourly_rate: ts.hourly_rate_snapshot || 0,
        mileage_rate: ts.mileage_rate_snapshot || 0,
        wages: 0,
        mileage_payment: 0,
        adjustments_total: 0,
      };
    }
    const d = empData[ts.employee_id];
    d.payable_minutes += ts.payable_minutes || 0;
    d.ordinary_hours += (ts.payable_minutes || 0) / 60;
    d.total_mileage_km += ts.total_mileage_km || 0;
    d.wages += ts.total_pay || 0;
    d.mileage_payment += ts.mileage_pay || 0;
    // Use latest rate snapshot
    if (ts.hourly_rate_snapshot) d.hourly_rate = ts.hourly_rate_snapshot;
    if (ts.mileage_rate_snapshot) d.mileage_rate = ts.mileage_rate_snapshot;
  }

  // Add adjustments
  for (const adj of adjustments || []) {
    if (!empData[adj.employee_id]) {
      empData[adj.employee_id] = {
        ordinary_hours: 0, payable_minutes: 0, total_mileage_km: 0,
        hourly_rate: 0, mileage_rate: 0, wages: 0, mileage_payment: 0,
        adjustments_total: 0,
      };
    }
    empData[adj.employee_id].adjustments_total += adj.amount;
  }

  // Upsert pay_period_items
  let totalGross = 0;
  let totalMileage = 0;
  let totalAdj = 0;
  let totalPayable = 0;

  for (const [empId, d] of Object.entries(empData)) {
    const empTotal = d.wages + d.mileage_payment + d.adjustments_total;
    totalGross += d.wages;
    totalMileage += d.mileage_payment;
    totalAdj += d.adjustments_total;
    totalPayable += empTotal;

    await (adminClient as any)
      .from("pay_period_items")
      .upsert({
        pay_period_id: payPeriodId,
        employee_id: empId,
        business_id: businessId,
        ordinary_hours: Math.round(d.ordinary_hours * 100) / 100,
        payable_minutes: d.payable_minutes,
        total_mileage_km: Math.round(d.total_mileage_km * 100) / 100,
        hourly_rate: d.hourly_rate,
        mileage_rate: d.mileage_rate,
        wages: Math.round(d.wages * 100) / 100,
        mileage_payment: Math.round(d.mileage_payment * 100) / 100,
        adjustments_total: Math.round(d.adjustments_total * 100) / 100,
        total_payable: Math.round(empTotal * 100) / 100,
        updated_at: new Date().toISOString(),
      }, { onConflict: "pay_period_id,employee_id" });
  }

  return {
    total_gross: Math.round(totalGross * 100) / 100,
    total_mileage: Math.round(totalMileage * 100) / 100,
    total_adjustments: Math.round(totalAdj * 100) / 100,
    total_payable: Math.round(totalPayable * 100) / 100,
  };
}
