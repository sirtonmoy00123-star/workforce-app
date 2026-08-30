// GET /api/leave/[id] — get single leave record
// PATCH /api/leave/[id] — approve/reject/cancel leave
// DELETE /api/leave/[id] — cancel a pending leave request (employee or admin)
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireMember();
    const adminClient = createAdminClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (adminClient as any)
      .from("employee_leave")
      .select("*, employees ( full_name, employee_number )")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Leave record not found." }, { status: 404 });
    }

    // Employee can only see their own leave
    if (ctx.role === "EMPLOYEE" && data.employee_id !== ctx.employeeId) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    }

    return NextResponse.json(data);
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

    const { status, adminNote } = body;

    // Validate status transition
    const validStatuses = ["APPROVED", "REJECTED", "CANCELLED"];
    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Status must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      );
    }

    // Fetch existing leave
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (adminClient as any)
      .from("employee_leave")
      .select("id, status, business_id")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Leave record not found." }, { status: 404 });
    }

    // Validate state transitions
    if (existing.status === "CANCELLED") {
      return NextResponse.json({ error: "Cannot modify a cancelled leave." }, { status: 400 });
    }
    if (existing.status === "REJECTED" && status !== "APPROVED") {
      return NextResponse.json({ error: "Rejected leave can only be re-approved." }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error } = await (adminClient as any)
      .from("employee_leave")
      .update({
        status,
        admin_note: adminNote || null,
        reviewed_by: ctx.userId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, leave: updated });
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireMember();
    const adminClient = createAdminClient();

    // Fetch existing leave
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (adminClient as any)
      .from("employee_leave")
      .select("id, status, employee_id, business_id")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Leave record not found." }, { status: 404 });
    }

    // Employee can only cancel their own pending leave
    if (ctx.role === "EMPLOYEE") {
      if (existing.employee_id !== ctx.employeeId) {
        return NextResponse.json({ error: "Not authorized." }, { status: 403 });
      }
      if (existing.status !== "PENDING") {
        return NextResponse.json({ error: "Can only cancel pending leave requests." }, { status: 400 });
      }
    }

    // Soft-delete: set status to CANCELLED
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (adminClient as any)
      .from("employee_leave")
      .update({
        status: "CANCELLED",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("business_id", ctx.businessId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleTenantError(err);
  }
}
