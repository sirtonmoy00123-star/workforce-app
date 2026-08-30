// POST /api/payroll/[id]/pay — mark employee(s) as paid within a locked pay period
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();
    const body = await request.json();

    const { employeeId, paymentReference, paymentNote, amount } = body;

    // Verify pay period is LOCKED
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

    if (payPeriod.status !== "LOCKED") {
      return NextResponse.json(
        { error: `Pay period must be LOCKED to mark payments. Current status: ${payPeriod.status}` },
        { status: 400 }
      );
    }

    if (employeeId) {
      // Mark single employee as paid
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: item } = await (adminClient as any)
        .from("pay_period_items")
        .select("*")
        .eq("pay_period_id", id)
        .eq("employee_id", employeeId)
        .single();

      if (!item) {
        return NextResponse.json({ error: "Pay period item not found for this employee." }, { status: 404 });
      }

      // Idempotent: if already paid, return success
      if (item.payment_status === "PAID") {
        return NextResponse.json({ success: true, message: "Already marked as paid.", item });
      }

      const paidAmount = amount !== undefined ? parseFloat(amount) : item.total_payable;
      const paymentStatus = paidAmount >= item.total_payable ? "PAID" : "PARTIAL";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: updated, error } = await (adminClient as any)
        .from("pay_period_items")
        .update({
          payment_status: paymentStatus,
          paid_amount: paidAmount,
          paid_at: new Date().toISOString(),
          payment_reference: paymentReference || null,
          payment_note: paymentNote || null,
          updated_at: new Date().toISOString(),
        })
        .eq("pay_period_id", id)
        .eq("employee_id", employeeId)
        .select("*")
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // Check if all employees are paid → auto-transition pay period to PAID
      await checkAndTransitionToPaid(adminClient, id, ctx.businessId, ctx.userId);

      return NextResponse.json({ success: true, item: updated });
    } else {
      // Mark ALL employees as paid
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: items } = await (adminClient as any)
        .from("pay_period_items")
        .select("*")
        .eq("pay_period_id", id)
        .neq("payment_status", "PAID");

      if (!items || items.length === 0) {
        return NextResponse.json({ success: true, message: "All employees already marked as paid." });
      }

      for (const item of items) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (adminClient as any)
          .from("pay_period_items")
          .update({
            payment_status: "PAID",
            paid_amount: item.total_payable,
            paid_at: new Date().toISOString(),
            payment_reference: paymentReference || null,
            payment_note: paymentNote || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id);
      }

      // Transition pay period to PAID
      await checkAndTransitionToPaid(adminClient, id, ctx.businessId, ctx.userId);

      return NextResponse.json({ success: true, paid: items.length });
    }
  } catch (err) {
    return handleTenantError(err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkAndTransitionToPaid(adminClient: any, payPeriodId: string, businessId: string, userId: string) {
  // Check if all items are PAID
  const { data: unpaid } = await (adminClient as any)
    .from("pay_period_items")
    .select("id")
    .eq("pay_period_id", payPeriodId)
    .neq("payment_status", "PAID")
    .limit(1);

  if (!unpaid || unpaid.length === 0) {
    // All paid → transition pay period
    await (adminClient as any)
      .from("pay_periods")
      .update({
        status: "PAID",
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", payPeriodId)
      .eq("business_id", businessId);

    // Audit
    await (adminClient as any).from("payroll_audit_log").insert({
      pay_period_id: payPeriodId,
      business_id: businessId,
      action: "STATUS_CHANGE",
      previous_status: "LOCKED",
      new_status: "PAID",
      performed_by: userId,
      metadata: { auto_transition: true, reason: "All employees paid" },
    });
  }
}
