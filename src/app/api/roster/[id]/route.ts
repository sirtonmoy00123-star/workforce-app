// GET /api/roster/[id] — get roster week detail with shifts
// PATCH /api/roster/[id] — update roster week (status, etc.)
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
    const { data: rosterWeek, error } = await (adminClient as any)
      .from("roster_weeks")
      .select("*")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (error || !rosterWeek) {
      return NextResponse.json({ error: "Roster week not found." }, { status: 404 });
    }

    // Get all shifts for this week
    const { data: shifts } = await adminClient
      .from("shifts")
      .select("*, employees ( id, full_name, employee_number )")
      .eq("business_id", ctx.businessId)
      .gte("date", rosterWeek.week_start)
      .lte("date", rosterWeek.week_end)
      .not("status", "in", '("cancelled","declined")')
      .order("date")
      .order("scheduled_start");

    return NextResponse.json({ ...rosterWeek, shifts: shifts || [] });
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

    const { status } = body;

    if (!status || !["DRAFT", "PUBLISHED", "ARCHIVED"].includes(status)) {
      return NextResponse.json({ error: "Status must be DRAFT, PUBLISHED, or ARCHIVED." }, { status: 400 });
    }

    // Fetch existing roster week
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rosterWeek } = await (adminClient as any)
      .from("roster_weeks")
      .select("*")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!rosterWeek) {
      return NextResponse.json({ error: "Roster week not found." }, { status: 404 });
    }

    // Update status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error } = await (adminClient as any)
      .from("roster_weeks")
      .update({
        status,
        updated_at: new Date().toISOString(),
        ...(status === "PUBLISHED" ? {
          published_at: new Date().toISOString(),
          published_by: ctx.userId,
        } : {}),
      })
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, rosterWeek: updated });
  } catch (err) {
    return handleTenantError(err);
  }
}
