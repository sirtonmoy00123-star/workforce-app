// GET /api/timesheets/[id] — get single timesheet details
// PUT /api/timesheets/[id] — admin approve/needs_correction
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

    const { data: timesheet, error } = await adminClient
      .from("timesheets")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !timesheet) {
      return NextResponse.json({ error: "Timesheet not found" }, { status: 404 });
    }

    // Verify business access
    if (timesheet.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Employee can only see their own
    if (ctx.role === "EMPLOYEE" && timesheet.employee_id !== ctx.employeeId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get employee info
    const { data: employee } = await adminClient
      .from("employees")
      .select("id, full_name, employee_number")
      .eq("id", timesheet.employee_id)
      .single();

    // Get odometer submissions for this shift
    const { data: odometerSubmissions } = await adminClient
      .from("odometer_submissions")
      .select("*")
      .eq("shift_id", timesheet.shift_id)
      .order("server_timestamp", { ascending: true });

    // Get shift info
    const { data: shift } = await adminClient
      .from("shifts")
      .select("location, instructions")
      .eq("id", timesheet.shift_id)
      .single();

    return NextResponse.json({
      ...timesheet,
      employee: employee ? { full_name: employee.full_name, employee_number: employee.employee_number } : null,
      odometer_submissions: odometerSubmissions || [],
      shift_location: shift?.location || null,
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
    const { action, approved_total } = body; // action: "approve" | "needs_correction"

    const adminClient = createAdminClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: timesheet } = await adminClient
      .from("timesheets")
      .select("*")
      .eq("id", id)
      .single() as { data: any };

    if (!timesheet) {
      return NextResponse.json({ error: "Timesheet not found" }, { status: 404 });
    }

    // Verify business access
    if (timesheet.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (action === "approve") {
      const finalTotal = approved_total !== undefined ? approved_total : timesheet.estimated_total;

      const { error } = await adminClient
        .from("timesheets")
        .update({
          status: "approved",
          approved_total: finalTotal,
          approved_by: ctx.userId,
          approved_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      // If there's a pending or submitted correction, mark it approved too
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (adminClient as any)
        .from("timesheet_corrections")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("timesheet_id", id)
        .in("status", ["pending", "submitted"]);

      return NextResponse.json({ success: true, status: "approved" });
    }

    if (action === "needs_correction") {
      const { error } = await adminClient
        .from("timesheets")
        .update({
          status: "needs_correction",
          approved_by: ctx.userId,
          approved_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, status: "needs_correction" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return handleTenantError(err);
  }
}
