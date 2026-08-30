// POST /api/roster/templates/[id]/apply — apply a template to a target week (creates draft shifts)
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";
import { buildShiftTimestamps, getBusinessTimezone } from "@/lib/calculations/timezone";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();
    const body = await request.json();

    const { weekStart } = body;

    if (!weekStart) {
      return NextResponse.json({ error: "weekStart is required (YYYY-MM-DD, must be a Monday)." }, { status: 400 });
    }

    // Validate it's a Monday
    const d = new Date(weekStart + "T12:00:00Z");
    if (d.getUTCDay() !== 1) {
      return NextResponse.json({ error: "weekStart must be a Monday." }, { status: 400 });
    }

    // Fetch template with shifts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: template } = await (adminClient as any)
      .from("roster_templates")
      .select("*, roster_template_shifts ( * )")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!template) {
      return NextResponse.json({ error: "Template not found." }, { status: 404 });
    }

    const templateShifts = template.roster_template_shifts || [];
    if (templateShifts.length === 0) {
      return NextResponse.json({ error: "Template has no shifts." }, { status: 400 });
    }

    // Get business timezone
    let tz: string;
    try {
      tz = await getBusinessTimezone(ctx.businessId);
    } catch {
      tz = "UTC";
    }

    // Ensure roster week exists
    const weekEnd = new Date(d);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminClient as any)
      .from("roster_weeks")
      .upsert({
        business_id: ctx.businessId,
        week_start: weekStart,
        week_end: weekEndStr,
        status: "DRAFT",
      }, { onConflict: "business_id,week_start", ignoreDuplicates: true });

    // Generate draft shifts from template
    const created: string[] = [];
    const skipped: string[] = [];

    // Map day_of_week (0=Sun) to actual date
    // Monday=1, Tuesday=2, ..., Sunday=0
    for (const ts of templateShifts) {
      // Calculate actual date: weekStart is Monday (day 1)
      // day_of_week: 0=Sun, 1=Mon, 2=Tue, ..., 6=Sat
      let daysFromMonday: number;
      if (ts.day_of_week === 0) {
        daysFromMonday = 6; // Sunday is 6 days after Monday
      } else {
        daysFromMonday = ts.day_of_week - 1; // Mon=0, Tue=1, etc.
      }

      const shiftDate = new Date(d);
      shiftDate.setUTCDate(shiftDate.getUTCDate() + daysFromMonday);
      const dateStr = shiftDate.toISOString().slice(0, 10);

      // Build timestamps
      const startTimeStr = ts.start_time.substring(0, 5);
      const endTimeStr = ts.end_time.substring(0, 5);

      let scheduledStart: string;
      let scheduledFinish: string;
      try {
        const stamps = buildShiftTimestamps(dateStr, startTimeStr, endTimeStr, tz);
        scheduledStart = stamps.scheduledStart;
        scheduledFinish = stamps.scheduledFinish;
      } catch {
        scheduledStart = new Date(`${dateStr}T${startTimeStr}:00Z`).toISOString();
        scheduledFinish = new Date(`${dateStr}T${endTimeStr}:00Z`).toISOString();
      }

      // Get rate snapshots if employee assigned
      let hourlyRate = null;
      let mileageRate = null;
      if (ts.employee_id) {
        const { data: emp } = await adminClient
          .from("employees")
          .select("hourly_rate, mileage_rate, employment_status")
          .eq("id", ts.employee_id)
          .eq("business_id", ctx.businessId)
          .single();

        if (!emp || emp.employment_status !== "active") {
          skipped.push(`${dateStr} ${startTimeStr}-${endTimeStr}: Employee inactive or not found`);
          continue;
        }
        hourlyRate = emp.hourly_rate;
        mileageRate = emp.mileage_rate;
      }

      // Create draft shift
      const { error } = await adminClient
        .from("shifts")
        .insert({
          business_id: ctx.businessId,
          employee_id: ts.employee_id || null,
          date: dateStr,
          scheduled_start: scheduledStart,
          scheduled_finish: scheduledFinish,
          location: ts.location || null,
          location_id: ts.location_id || null,
          instructions: ts.instructions || null,
          require_odometer: ts.require_odometer,
          hourly_rate_snapshot: hourlyRate,
          mileage_rate_snapshot: mileageRate,
          status: "draft" as "pending",
          created_by: ctx.userId,
        });

      if (error) {
        skipped.push(`${dateStr} ${startTimeStr}-${endTimeStr}: ${error.message}`);
      } else {
        created.push(`${dateStr} ${startTimeStr}-${endTimeStr}`);
      }
    }

    return NextResponse.json({
      success: true,
      templateName: template.name,
      weekStart,
      created: created.length,
      skipped: skipped.length,
      details: { created, skipped },
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
