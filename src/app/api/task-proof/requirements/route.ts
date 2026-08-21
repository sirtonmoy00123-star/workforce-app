// POST /api/task-proof/requirements — create task proof requirements for a shift
// GET /api/task-proof/requirements?shiftId=xxx — get requirements for a shift
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, requireMember, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(request: Request) {
  try {
    const ctx = await requireMember();
    const url = new URL(request.url);
    const shiftId = url.searchParams.get("shiftId");

    if (!shiftId) {
      return NextResponse.json({ error: "shiftId is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Verify shift belongs to same business
    const { data: shift } = await adminClient
      .from("shifts")
      .select("id, business_id, employee_id")
      .eq("id", shiftId)
      .single();

    if (!shift || shift.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    }

    // Employee can only see requirements for their own shifts
    if (ctx.role === "EMPLOYEE" && shift.employee_id !== ctx.employeeId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: requirements, error } = await adminClient
      .from("task_proof_requirements")
      .select("*")
      .eq("shift_id", shiftId)
      .eq("business_id", ctx.businessId)
      .order("sort_order");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(requirements || []);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();
    const body = await request.json();
    const { shiftId, requirements } = body;

    if (!shiftId) {
      return NextResponse.json({ error: "shiftId is required." }, { status: 400 });
    }

    if (!requirements || !Array.isArray(requirements) || requirements.length === 0) {
      return NextResponse.json({ error: "At least one proof requirement is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Verify shift belongs to same business
    const { data: shift } = await adminClient
      .from("shifts")
      .select("id, business_id")
      .eq("id", shiftId)
      .single();

    if (!shift || shift.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    }

    // Delete existing requirements for this shift (re-configure)
    await adminClient
      .from("task_proof_requirements")
      .delete()
      .eq("shift_id", shiftId)
      .eq("business_id", ctx.businessId);

    // Create new requirements (snapshot/copy semantics)
    const rows = requirements.map((req: {
      proof_type: string;
      instruction?: string;
      minimum_photos?: number;
      maximum_photos?: number;
      is_required?: boolean;
      allow_employee_note?: boolean;
      allow_finish_without_proof?: boolean;
    }, idx: number) => ({
      business_id: ctx.businessId,
      shift_id: shiftId as string,
      proof_type: req.proof_type as "BEFORE" | "DURING" | "AFTER" | "OTHER",
      instruction: req.instruction || null,
      minimum_photos: req.minimum_photos || 1,
      maximum_photos: req.maximum_photos || 6,
      is_required: req.is_required !== false,
      allow_employee_note: req.allow_employee_note !== false,
      allow_finish_without_proof: req.allow_finish_without_proof !== false,
      sort_order: idx,
      created_by: ctx.userId,
    }));

    const { error: insertError } = await adminClient
      .from("task_proof_requirements")
      .insert(rows);

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, count: rows.length });
  } catch (err) {
    return handleTenantError(err);
  }
}
