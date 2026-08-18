// GET /api/payments/[id] — get single payment
// PUT /api/payments/[id] — mark as paid
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireMember();
    const adminClient = createAdminClient();

    const { data: payment, error } = await adminClient
      .from("payments")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    // Verify business access
    if (payment.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Employee can only see their own
    if (ctx.role === "EMPLOYEE" && payment.employee_id !== ctx.employeeId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get employee info
    const { data: employee } = await adminClient
      .from("employees")
      .select("id, full_name, employee_number")
      .eq("id", payment.employee_id)
      .single();

    return NextResponse.json({
      ...payment,
      employee: employee ? { full_name: employee.full_name, employee_number: employee.employee_number } : null,
    });
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireAdmin();

    const body = await request.json();
    const { action } = body; // "mark_paid"

    const adminClient = createAdminClient();

    const { data: payment } = await adminClient
      .from("payments")
      .select("*")
      .eq("id", id)
      .single();

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    // Verify business access
    if (payment.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (action === "mark_paid") {
      if (payment.status === "paid") {
        return NextResponse.json({ error: "Payment is already marked as paid." }, { status: 400 });
      }

      const { error } = await adminClient
        .from("payments")
        .update({
          status: "paid",
          payment_date: new Date().toISOString().split("T")[0],
          marked_paid_by: ctx.userId,
        })
        .eq("id", id);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, status: "paid" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return handleTenantError(err);
  }
}
