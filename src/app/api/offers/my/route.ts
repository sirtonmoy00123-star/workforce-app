// GET /api/offers/my — get open shift offers for the current employee
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, handleTenantError } from "@/lib/services/tenantContext";

export async function GET() {
  try {
    const ctx = await requireMember();

    if (!ctx.employeeId) {
      // Admins/owners don't have employee offers
      return NextResponse.json([]);
    }

    const adminClient = createAdminClient();

    // Get all offer recipients for this employee
    const { data: recipients, error } = await adminClient
      .from("open_shift_offer_recipients")
      .select("id, offer_id, status, sent_at, responded_at, shift_id")
      .eq("employee_id", ctx.employeeId)
      .eq("business_id", ctx.businessId)
      .order("sent_at", { ascending: false });

    if (error || !recipients || recipients.length === 0) {
      return NextResponse.json([]);
    }

    // Get the offers
    const offerIds = [...new Set(recipients.map((r) => r.offer_id))];
    const { data: offers } = await adminClient
      .from("open_shift_offers")
      .select("id, event_id, role, positions_required, positions_filled, status, expires_at")
      .in("id", offerIds);

    if (!offers || offers.length === 0) {
      return NextResponse.json([]);
    }

    // Get the events
    const eventIds = [...new Set(offers.map((o) => o.event_id))];
    const { data: events } = await adminClient
      .from("staffing_events")
      .select("id, name, event_date, location, start_time, finish_time, status")
      .in("id", eventIds);

    // Build combined response
    const offersMap = Object.fromEntries((offers || []).map((o) => [o.id, o]));
    const eventsMap = Object.fromEntries((events || []).map((e) => [e.id, e]));

    const result = recipients.map((r) => {
      const offer = offersMap[r.offer_id];
      const event = offer ? eventsMap[offer.event_id] : null;
      return {
        recipient_id: r.id,
        offer_id: r.offer_id,
        recipient_status: r.status,
        sent_at: r.sent_at,
        responded_at: r.responded_at,
        shift_id: r.shift_id,
        offer: offer
          ? {
              role: offer.role,
              positions_required: offer.positions_required,
              positions_filled: offer.positions_filled,
              offer_status: offer.status,
              expires_at: offer.expires_at,
            }
          : null,
        event: event
          ? {
              id: event.id,
              name: event.name,
              event_date: event.event_date,
              location: event.location,
              start_time: event.start_time,
              finish_time: event.finish_time,
              event_status: event.status,
            }
          : null,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleTenantError(err);
  }
}
