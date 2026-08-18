// GET  /api/events/[id] — get event details with requirements, offers, recipients
// PUT  /api/events/[id] — update event (edit, cancel, update status)
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, requireMember, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireMember();
    const adminClient = createAdminClient();

    // Get event
    const { data: event, error } = await adminClient
      .from("staffing_events")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    if (event.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get requirements
    const { data: requirements } = await adminClient
      .from("event_staffing_requirements")
      .select("*")
      .eq("event_id", id);

    // Get open offers
    const { data: offers } = await adminClient
      .from("open_shift_offers")
      .select("*")
      .eq("event_id", id)
      .eq("business_id", ctx.businessId);

    // Get offer recipients
    const offerIds = (offers || []).map((o) => o.id);
    let recipients: { id: string; offer_id: string; employee_id: string; status: string; shift_id: string | null; sent_at: string; responded_at: string | null }[] = [];
    if (offerIds.length > 0) {
      const { data: recs } = await adminClient
        .from("open_shift_offer_recipients")
        .select("id, offer_id, employee_id, status, shift_id, sent_at, responded_at")
        .in("offer_id", offerIds);
      recipients = recs || [];
    }

    // Get shifts linked to this event
    const { data: eventShifts } = await adminClient
      .from("shifts")
      .select("id, employee_id, date, scheduled_start, scheduled_finish, status")
      .eq("event_id", id)
      .eq("business_id", ctx.businessId);

    // Get employee names for linked shifts and recipients
    const employeeIds = new Set<string>();
    eventShifts?.forEach((s) => employeeIds.add(s.employee_id));
    recipients.forEach((r) => employeeIds.add(r.employee_id));

    let employeeMap: Record<string, string> = {};
    if (employeeIds.size > 0) {
      const { data: emps } = await adminClient
        .from("employees")
        .select("id, full_name, employment_type, open_to_extra_shifts")
        .in("id", Array.from(employeeIds));
      if (emps) {
        employeeMap = Object.fromEntries(emps.map((e) => [e.id, e.full_name]));
      }
    }

    // Get audit log
    const { data: auditLog } = await adminClient
      .from("event_audit_log")
      .select("*")
      .eq("event_id", id)
      .order("created_at", { ascending: false })
      .limit(50);

    // Attach recipients to their offers
    const offersWithRecipients = (offers || []).map((o) => ({
      ...o,
      recipients: recipients.filter((r) => r.offer_id === o.id),
    }));

    return NextResponse.json({
      ...event,
      event_staffing_requirements: requirements || [],
      offers: offersWithRecipients,
      eventShifts: eventShifts || [],
      employeeMap,
      auditLog: auditLog || [],
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
    const adminClient = createAdminClient();

    const body = await request.json();
    const { action } = body;

    // Get event
    const { data: event } = await adminClient
      .from("staffing_events")
      .select("*")
      .eq("id", id)
      .single();

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    if (event.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ── Cancel event ──
    if (action === "cancel") {
      if (event.status === "CANCELLED" || event.status === "COMPLETED") {
        return NextResponse.json({ error: "Event is already " + event.status.toLowerCase() + "." }, { status: 400 });
      }

      // Cancel linked shifts that are pending or accepted
      const { data: linkedShifts } = await adminClient
        .from("shifts")
        .select("id, status")
        .eq("event_id", id)
        .in("status", ["pending", "accepted", "updated_pending"]);

      if (linkedShifts && linkedShifts.length > 0) {
        await adminClient
          .from("shifts")
          .update({ status: "cancelled", last_change_reason: `Event "${event.name}" cancelled` })
          .eq("event_id", id)
          .in("status", ["pending", "accepted", "updated_pending"]);
      }

      // Close any open offers
      await adminClient
        .from("open_shift_offers")
        .update({ status: "CANCELLED" })
        .eq("event_id", id)
        .in("status", ["OPEN", "PARTIALLY_FILLED"]);

      // Close pending recipients
      await adminClient
        .from("open_shift_offer_recipients")
        .update({ status: "CLOSED" })
        .eq("business_id", ctx.businessId)
        .in("offer_id",
          (await adminClient.from("open_shift_offers").select("id").eq("event_id", id)).data?.map((o) => o.id) || []
        )
        .eq("status", "PENDING");

      // Update event status
      await adminClient
        .from("staffing_events")
        .update({ status: "CANCELLED" })
        .eq("id", id);

      // Audit
      await adminClient.from("event_audit_log").insert({
        business_id: ctx.businessId,
        event_id: id,
        action: "cancelled",
        details: { cancelled_shifts: linkedShifts?.length || 0 },
        performed_by: ctx.userId,
      });

      return NextResponse.json({ success: true, message: "Event cancelled." });
    }

    // ── Edit event ──
    if (action === "edit") {
      const { name, description, event_date, location, startTime, finishTime, role, required_count, instructions } = body;

      if (!name || !event_date || !startTime || !finishTime) {
        return NextResponse.json({ error: "Event name, date, start time, and finish time are required." }, { status: 400 });
      }

      const startISO = new Date(`${event_date}T${startTime}:00`).toISOString();
      const finishISO = new Date(`${event_date}T${finishTime}:00`).toISOString();

      // Update event
      await adminClient
        .from("staffing_events")
        .update({
          name,
          description: description || null,
          event_date,
          location: location || null,
          start_time: startISO,
          finish_time: finishISO,
        })
        .eq("id", id);

      // Update requirement if provided
      if (role !== undefined || required_count !== undefined || instructions !== undefined) {
        const { data: reqs } = await adminClient
          .from("event_staffing_requirements")
          .select("id")
          .eq("event_id", id)
          .limit(1);

        if (reqs && reqs.length > 0) {
          await adminClient
            .from("event_staffing_requirements")
            .update({
              role: role !== undefined ? role : undefined,
              required_count: required_count !== undefined ? parseInt(required_count, 10) : undefined,
              instructions: instructions !== undefined ? (instructions || null) : undefined,
              start_time: startISO,
              finish_time: finishISO,
            })
            .eq("id", reqs[0].id);
        }
      }

      // Check if linked shifts need reconfirmation (date/time/location changed)
      const dateChanged = event.event_date !== event_date;
      const startChanged = event.start_time !== startISO;
      const finishChanged = event.finish_time !== finishISO;
      const locationChanged = (event.location || "") !== (location || "");
      const needsReconfirmation = dateChanged || startChanged || finishChanged || locationChanged;

      if (needsReconfirmation) {
        // Update linked accepted shifts to updated_pending
        await adminClient
          .from("shifts")
          .update({
            date: event_date,
            scheduled_start: startISO,
            scheduled_finish: finishISO,
            location: location || null,
            status: "updated_pending",
            last_change_reason: `Event "${name}" was updated`,
          })
          .eq("event_id", id)
          .eq("status", "accepted");

        // Also update pending shifts silently
        await adminClient
          .from("shifts")
          .update({
            date: event_date,
            scheduled_start: startISO,
            scheduled_finish: finishISO,
            location: location || null,
          })
          .eq("event_id", id)
          .eq("status", "pending");
      }

      // Audit
      await adminClient.from("event_audit_log").insert({
        business_id: ctx.businessId,
        event_id: id,
        action: "edited",
        details: { name, event_date, location, startTime, finishTime, needsReconfirmation },
        performed_by: ctx.userId,
      });

      return NextResponse.json({
        success: true,
        message: needsReconfirmation
          ? "Event updated. Accepted shifts require employee reconfirmation."
          : "Event updated.",
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return handleTenantError(err);
  }
}
