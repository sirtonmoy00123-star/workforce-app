// POST /api/events/[id]/send-offer — send open shift offer to selected employees
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: eventId } = await params;
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();

    const body = await request.json();
    const { employeeIds, expiresAt } = body;

    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return NextResponse.json({ error: "Select at least one worker." }, { status: 400 });
    }

    // 1. Get event + requirement
    const { data: event } = await adminClient
      .from("staffing_events")
      .select("*")
      .eq("id", eventId)
      .eq("business_id", ctx.businessId)
      .single();

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    if (event.status === "CANCELLED" || event.status === "COMPLETED") {
      return NextResponse.json({ error: "Event is " + event.status.toLowerCase() + "." }, { status: 400 });
    }

    const { data: requirements } = await adminClient
      .from("event_staffing_requirements")
      .select("*")
      .eq("event_id", eventId);

    const req = requirements?.[0];
    if (!req) {
      return NextResponse.json({ error: "No staffing requirement found." }, { status: 400 });
    }

    // 2. Calculate remaining positions
    const remaining = Math.max(0, req.required_count - (req.filled_count || 0));
    if (remaining <= 0) {
      return NextResponse.json({ error: "Event is already fully staffed." }, { status: 400 });
    }

    // 3. Verify employees are active and in this business
    const { data: employees } = await adminClient
      .from("employees")
      .select("id, full_name, employment_status")
      .eq("business_id", ctx.businessId)
      .in("id", employeeIds);

    if (!employees || employees.length === 0) {
      return NextResponse.json({ error: "No valid employees found." }, { status: 400 });
    }

    const activeEmployees = employees.filter((e) => e.employment_status === "active");
    if (activeEmployees.length === 0) {
      return NextResponse.json({ error: "No active employees in selection." }, { status: 400 });
    }

    // 4. Check for employees who already have a pending offer for this event
    const { data: existingRecipients } = await adminClient
      .from("open_shift_offer_recipients")
      .select("employee_id, offer_id")
      .in("employee_id", activeEmployees.map((e) => e.id))
      .eq("status", "PENDING");

    // Get offer IDs for this event
    const { data: existingOffers } = await adminClient
      .from("open_shift_offers")
      .select("id")
      .eq("event_id", eventId)
      .in("status", ["OPEN", "PARTIALLY_FILLED"]);

    const existingOfferIds = new Set((existingOffers || []).map((o) => o.id));
    const alreadyPendingIds = new Set(
      (existingRecipients || [])
        .filter((r) => existingOfferIds.has(r.offer_id))
        .map((r) => r.employee_id)
    );

    const newEmployees = activeEmployees.filter((e) => !alreadyPendingIds.has(e.id));
    if (newEmployees.length === 0) {
      return NextResponse.json({
        error: "All selected workers already have a pending offer for this event.",
      }, { status: 400 });
    }

    // 5. Create the open shift offer
    const { data: offer, error: offerError } = await adminClient
      .from("open_shift_offers")
      .insert({
        business_id: ctx.businessId,
        event_id: eventId,
        requirement_id: req.id,
        role: req.role,
        positions_required: remaining,
        positions_filled: 0,
        status: "OPEN",
        expires_at: expiresAt || null,
        created_by: ctx.userId,
      })
      .select("*")
      .single();

    if (offerError || !offer) {
      return NextResponse.json({
        error: offerError?.message || "Failed to create offer.",
      }, { status: 500 });
    }

    // 6. Create recipient records
    const recipientInserts = newEmployees.map((e) => ({
      business_id: ctx.businessId,
      offer_id: offer.id,
      employee_id: e.id,
      status: "PENDING" as const,
    }));

    const { error: recipientError } = await adminClient
      .from("open_shift_offer_recipients")
      .insert(recipientInserts);

    if (recipientError) {
      // Rollback: delete the offer
      await adminClient.from("open_shift_offers").delete().eq("id", offer.id);
      return NextResponse.json({
        error: recipientError.message || "Failed to create recipient records.",
      }, { status: 500 });
    }

    // 7. Audit log
    await adminClient.from("event_audit_log").insert({
      business_id: ctx.businessId,
      event_id: eventId,
      action: "offer_sent",
      details: {
        offer_id: offer.id,
        sent_to: newEmployees.map((e) => e.full_name),
        count: newEmployees.length,
        positions_required: remaining,
        role: req.role,
      },
      performed_by: ctx.userId,
    });

    return NextResponse.json({
      success: true,
      offer_id: offer.id,
      sent_to: newEmployees.length,
      skipped_already_pending: alreadyPendingIds.size,
      positions_required: remaining,
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
