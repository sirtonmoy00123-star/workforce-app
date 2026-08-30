// GET /api/roster/templates — list roster templates
// POST /api/roster/templates — create a template
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET() {
  try {
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (adminClient as any)
      .from("roster_templates")
      .select("*, roster_template_shifts ( * )")
      .eq("business_id", ctx.businessId)
      .eq("is_active", true)
      .order("name");

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

    const { name, description, shifts } = body;

    if (!name) {
      return NextResponse.json({ error: "Template name is required." }, { status: 400 });
    }

    // Create template
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: template, error } = await (adminClient as any)
      .from("roster_templates")
      .insert({
        business_id: ctx.businessId,
        name,
        description: description || null,
        created_by: ctx.userId,
      })
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Insert template shifts if provided
    if (shifts && Array.isArray(shifts) && shifts.length > 0) {
      const templateShifts = shifts.map((s: {
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        employeeId?: string;
        roleLabel?: string;
        location?: string;
        locationId?: string;
        instructions?: string;
        requireOdometer?: boolean;
        requireAttendance?: boolean;
      }) => ({
        template_id: template.id,
        day_of_week: s.dayOfWeek,
        start_time: s.startTime,
        end_time: s.endTime,
        employee_id: s.employeeId || null,
        role_label: s.roleLabel || null,
        location: s.location || null,
        location_id: s.locationId || null,
        instructions: s.instructions || null,
        require_odometer: s.requireOdometer ?? null,
        require_attendance: s.requireAttendance ?? true,
      }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: shiftsError } = await (adminClient as any)
        .from("roster_template_shifts")
        .insert(templateShifts);

      if (shiftsError) {
        return NextResponse.json({ error: shiftsError.message }, { status: 500 });
      }
    }

    // Return template with shifts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: full } = await (adminClient as any)
      .from("roster_templates")
      .select("*, roster_template_shifts ( * )")
      .eq("id", template.id)
      .single();

    return NextResponse.json({ success: true, template: full });
  } catch (err) {
    return handleTenantError(err);
  }
}
