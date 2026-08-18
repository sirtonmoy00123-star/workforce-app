// GET /api/timesheets/[id]/corrections — list corrections for a timesheet
// POST /api/timesheets/[id]/corrections — admin creates a correction request
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

const VALID_FIELDS = [
  "actual_start",
  "actual_finish",
  "start_odometer",
  "finish_odometer",
  "start_photo",
  "finish_photo",
  "other",
];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireMember(); // just authenticate — corrections are tied to a timesheet the user already has access to

    const adminClient = createAdminClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: corrections, error } = await (adminClient as any)
      .from("timesheet_corrections")
      .select("*")
      .eq("timesheet_id", id)
      .order("correction_round", { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(corrections || []);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireAdmin();

    const body = await request.json();
    const { requested_fields, admin_note } = body;

    // Validate requested fields
    if (!Array.isArray(requested_fields) || requested_fields.length === 0) {
      return NextResponse.json({ error: "Select at least one field to correct." }, { status: 400 });
    }
    for (const field of requested_fields) {
      if (!VALID_FIELDS.includes(field)) {
        return NextResponse.json({ error: `Invalid field: ${field}` }, { status: 400 });
      }
    }
    if (!admin_note || admin_note.trim().length === 0) {
      return NextResponse.json({ error: "A note to the employee is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Fetch the timesheet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: timesheet } = await adminClient
      .from("timesheets")
      .select("*")
      .eq("id", id)
      .single() as { data: any };

    if (!timesheet) {
      return NextResponse.json({ error: "Timesheet not found." }, { status: 404 });
    }

    // Verify business ownership
    if (timesheet.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check timesheet is in a correctable state
    if (timesheet.status !== "submitted" && timesheet.status !== "correction_submitted") {
      return NextResponse.json({
        error: "This timesheet cannot be sent for correction in its current status.",
      }, { status: 400 });
    }

    // Determine correction round
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingCorrections } = await (adminClient as any)
      .from("timesheet_corrections")
      .select("correction_round")
      .eq("timesheet_id", id)
      .order("correction_round", { ascending: false })
      .limit(1);

    const correctionRound = existingCorrections && existingCorrections.length > 0
      ? existingCorrections[0].correction_round + 1
      : 1;

    // Get odometer submissions for photo paths
    const { data: odometerSubs } = await adminClient
      .from("odometer_submissions")
      .select("submission_type, photo_path, odometer_reading")
      .eq("shift_id", timesheet.shift_id);

    const startOdometerSub = odometerSubs?.find((s: { submission_type: string }) => s.submission_type === "START");
    const finishOdometerSub = odometerSubs?.find((s: { submission_type: string }) => s.submission_type === "FINISH");

    // Snapshot original values
    const originalValues = {
      actual_start: timesheet.actual_start,
      actual_finish: timesheet.actual_finish,
      start_odometer: timesheet.start_odometer,
      finish_odometer: timesheet.finish_odometer,
      worked_minutes: timesheet.worked_minutes,
      distance_km: timesheet.distance_km,
      wage_amount: timesheet.wage_amount,
      mileage_amount: timesheet.mileage_amount,
      estimated_total: timesheet.estimated_total,
      start_photo: startOdometerSub?.photo_path || null,
      finish_photo: finishOdometerSub?.photo_path || null,
    };

    // Create correction record
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: correction, error: insertError } = await (adminClient as any)
      .from("timesheet_corrections")
      .insert({
        business_id: ctx.businessId,
        timesheet_id: id,
        employee_id: timesheet.employee_id,
        correction_round: correctionRound,
        requested_fields,
        admin_note: admin_note.trim(),
        original_values: originalValues,
        requested_by: ctx.userId,
        status: "pending",
      })
      .select("id")
      .single();

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Update timesheet status
    await adminClient
      .from("timesheets")
      .update({ status: "correction_required" })
      .eq("id", id);

    return NextResponse.json({
      success: true,
      correction_id: correction?.id,
      correction_round: correctionRound,
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
