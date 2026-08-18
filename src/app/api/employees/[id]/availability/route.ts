// GET /api/employees/[id]/availability — get weekly availability
// PUT /api/employees/[id]/availability — set/update weekly availability (all 7 days)
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();

    // Verify employee belongs to this business
    const { data: employee } = await adminClient
      .from("employees")
      .select("id")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const { data: availability, error } = await adminClient
      .from("employee_availability")
      .select("*")
      .eq("employee_id", id)
      .eq("business_id", ctx.businessId)
      .order("day_of_week");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(availability || []);
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
    const adminClient = createAdminClient();

    // Verify employee belongs to this business
    const { data: employee } = await adminClient
      .from("employees")
      .select("id")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const body = await request.json();
    const { days } = body;
    // days is an array of 7 entries: [{ dayOfWeek: 0, isAvailable: bool, startTime: "HH:MM", endTime: "HH:MM" }, ...]

    if (!Array.isArray(days) || days.length !== 7) {
      return NextResponse.json(
        { error: "Must provide availability for all 7 days." },
        { status: 400 }
      );
    }

    // Delete existing availability for this employee, then insert fresh
    await adminClient
      .from("employee_availability")
      .delete()
      .eq("employee_id", id);

    const rows = days.map((day: { dayOfWeek: number; isAvailable: boolean; startTime: string | null; endTime: string | null }) => ({
      employee_id: id,
      business_id: ctx.businessId,
      day_of_week: day.dayOfWeek,
      is_available: day.isAvailable,
      start_time: day.isAvailable ? day.startTime : null,
      end_time: day.isAvailable ? day.endTime : null,
      created_by: ctx.userId,
    }));

    const { error } = await adminClient
      .from("employee_availability")
      .insert(rows);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleTenantError(err);
  }
}
