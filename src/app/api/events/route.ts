// GET  /api/events — list staffing events for the business
// POST /api/events — create a new staffing event + requirements
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, requireMember, handleTenantError } from "@/lib/services/tenantContext";
import { buildShiftTimestamps, getBusinessTimezone } from "@/lib/calculations/timezone";

export async function GET(request: Request) {
  try {
    const ctx = await requireMember();
    const adminClient = createAdminClient();

    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const upcoming = url.searchParams.get("upcoming"); // "true" = event_date >= today

    let query = adminClient
      .from("staffing_events")
      .select("*")
      .eq("business_id", ctx.businessId)
      .order("event_date", { ascending: true });

    if (status) {
      query = query.eq("status", status as "DRAFT" | "OPEN" | "PARTIALLY_FILLED" | "FULLY_STAFFED" | "CANCELLED" | "COMPLETED");
    }

    if (upcoming === "true") {
      const today = new Date().toISOString().split("T")[0];
      query = query.gte("event_date", today);
    }

    const { data: events, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (!events || events.length === 0) {
      return NextResponse.json([]);
    }

    // Get requirements for all events
    const eventIds = events.map((e) => e.id);
    const { data: requirements } = await adminClient
      .from("event_staffing_requirements")
      .select("*")
      .in("event_id", eventIds);

    // Attach requirements to events
    const eventsWithReqs = events.map((e) => ({
      ...e,
      event_staffing_requirements: (requirements || []).filter((r) => r.event_id === e.id),
    }));

    return NextResponse.json(eventsWithReqs);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();

    const body = await request.json();
    const {
      name,
      description,
      event_date,
      location,
      startTime,
      finishTime,
      role,
      required_count,
      instructions,
      reminder_days_before,
    } = body;

    // Validation
    if (!name || !event_date || !startTime || !finishTime) {
      return NextResponse.json(
        { error: "Event name, date, start time, and finish time are required." },
        { status: 400 }
      );
    }

    if (!required_count || required_count < 1) {
      return NextResponse.json(
        { error: "At least 1 extra worker is required." },
        { status: 400 }
      );
    }

    // Build timestamps using business timezone (handles overnight + DST)
    let startISO: string;
    let finishISO: string;
    try {
      const tz = await getBusinessTimezone(ctx.businessId);
      const stamps = buildShiftTimestamps(event_date, startTime, finishTime, tz);
      startISO = stamps.scheduledStart;
      finishISO = stamps.scheduledFinish;
    } catch {
      startISO = new Date(`${event_date}T${startTime}:00`).toISOString();
      finishISO = new Date(`${event_date}T${finishTime}:00`).toISOString();
    }

    // Validate finish is after start (using UTC timestamps, handles overnight)
    if (finishISO <= startISO) {
      return NextResponse.json(
        { error: "Finish time must be after start time." },
        { status: 400 }
      );
    }

    // 1. Create the event
    const { data: event, error: eventError } = await adminClient
      .from("staffing_events")
      .insert({
        business_id: ctx.businessId,
        name,
        description: description || null,
        event_date,
        location: location || null,
        start_time: startISO,
        finish_time: finishISO,
        status: "OPEN",
        reminder_days_before: reminder_days_before ?? 7,
        created_by: ctx.userId,
      })
      .select("*")
      .single();

    if (eventError || !event) {
      return NextResponse.json(
        { error: eventError?.message || "Failed to create event." },
        { status: 500 }
      );
    }

    // 2. Create the staffing requirement
    const { data: requirement, error: reqError } = await adminClient
      .from("event_staffing_requirements")
      .insert({
        business_id: ctx.businessId,
        event_id: event.id,
        role: role || "General",
        required_count: parseInt(required_count, 10),
        start_time: startISO,
        finish_time: finishISO,
        instructions: instructions || null,
      })
      .select("*")
      .single();

    if (reqError) {
      // Rollback: delete the event
      await adminClient.from("staffing_events").delete().eq("id", event.id);
      return NextResponse.json(
        { error: reqError.message || "Failed to create requirement." },
        { status: 500 }
      );
    }

    // 3. Audit log
    await adminClient.from("event_audit_log").insert({
      business_id: ctx.businessId,
      event_id: event.id,
      action: "created",
      details: {
        name,
        event_date,
        location,
        startTime,
        finishTime,
        role: role || "General",
        required_count,
      },
      performed_by: ctx.userId,
    });

    return NextResponse.json({
      success: true,
      event: { ...event, event_staffing_requirements: [requirement] },
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
