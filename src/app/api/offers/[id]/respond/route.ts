// POST /api/offers/[id]/respond — employee accepts or declines an open shift offer
// [id] is the recipient_id (not the offer_id)
// Uses the atomic accept_open_shift_offer() PG function for acceptance
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, handleTenantError } from "@/lib/services/tenantContext";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: recipientId } = await params;
    const ctx = await requireMember();

    if (!ctx.employeeId) {
      return NextResponse.json({ error: "Only employees can respond to offers." }, { status: 403 });
    }

    const body = await request.json();
    const { action } = body; // "accept" or "decline"

    if (!action || !["accept", "decline"].includes(action)) {
      return NextResponse.json({ error: "Action must be 'accept' or 'decline'." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // 1. Get the recipient record
    const { data: recipient } = await adminClient
      .from("open_shift_offer_recipients")
      .select("id, offer_id, employee_id, status, business_id")
      .eq("id", recipientId)
      .single();

    if (!recipient) {
      return NextResponse.json({ error: "Offer not found." }, { status: 404 });
    }

    // Verify this is the right employee
    if (recipient.employee_id !== ctx.employeeId) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    if (recipient.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    if (recipient.status !== "PENDING") {
      return NextResponse.json({
        error: "You have already responded to this offer.",
      }, { status: 400 });
    }

    // ── DECLINE ──
    if (action === "decline") {
      await adminClient
        .from("open_shift_offer_recipients")
        .update({ status: "DECLINED", responded_at: new Date().toISOString() })
        .eq("id", recipientId);

      // Get event_id for audit
      const { data: offer } = await adminClient
        .from("open_shift_offers")
        .select("event_id")
        .eq("id", recipient.offer_id)
        .single();

      if (offer) {
        await adminClient.from("event_audit_log").insert({
          business_id: ctx.businessId,
          event_id: offer.event_id,
          action: "offer_declined",
          details: { employee_id: ctx.employeeId, recipient_id: recipientId },
          performed_by: ctx.userId,
        });
      }

      return NextResponse.json({ success: true, action: "declined" });
    }

    // ── ACCEPT ──

    // 2. Get the offer to check event details for validation
    const { data: offer } = await adminClient
      .from("open_shift_offers")
      .select("id, event_id, role, status, positions_required, positions_filled")
      .eq("id", recipient.offer_id)
      .single();

    if (!offer) {
      return NextResponse.json({ error: "Offer not found." }, { status: 404 });
    }

    if (!["OPEN", "PARTIALLY_FILLED"].includes(offer.status)) {
      return NextResponse.json({ error: "This shift is now fully staffed." }, { status: 400 });
    }

    // 3. Get event for shift creation details
    const { data: event } = await adminClient
      .from("staffing_events")
      .select("*")
      .eq("id", offer.event_id)
      .single();

    if (!event) {
      return NextResponse.json({ error: "Event not found." }, { status: 404 });
    }

    if (event.status === "CANCELLED") {
      return NextResponse.json({ error: "This event has been cancelled." }, { status: 400 });
    }

    // 4. Re-validate: check employee is still active
    const { data: employee } = await adminClient
      .from("employees")
      .select("id, employment_status")
      .eq("id", ctx.employeeId)
      .eq("business_id", ctx.businessId)
      .single();

    if (!employee || employee.employment_status !== "active") {
      return NextResponse.json({ error: "Your account is not active." }, { status: 400 });
    }

    // 5. Re-validate: check for overlapping shifts
    const { data: overlapping } = await adminClient
      .from("shifts")
      .select("id")
      .eq("employee_id", ctx.employeeId)
      .eq("date", event.event_date)
      .not("status", "in", '("cancelled","declined")')
      .or(
        `and(scheduled_start.lt.${event.finish_time},scheduled_finish.gt.${event.start_time})`
      );

    if (overlapping && overlapping.length > 0) {
      return NextResponse.json({
        error: "You already have a shift at this time.",
      }, { status: 400 });
    }

    // 6. ATOMIC ACCEPT — call the PG function with row locking
    const { data: atomicResult, error: rpcError } = await adminClient
      .rpc("accept_open_shift_offer", {
        p_offer_id: offer.id,
        p_recipient_id: recipientId,
        p_employee_id: ctx.employeeId,
        p_business_id: ctx.businessId,
      });

    if (rpcError) {
      return NextResponse.json({
        error: rpcError.message || "Failed to accept offer.",
      }, { status: 500 });
    }

    const result = atomicResult as {
      success: boolean;
      error?: string;
      positions_filled?: number;
      positions_required?: number;
      offer_now_filled?: boolean;
    };

    if (!result.success) {
      return NextResponse.json({
        error: result.error || "This shift is now fully staffed.",
      }, { status: 400 });
    }

    // 7. Create the actual shift (the PG function handles the offer/recipient bookkeeping,
    //    but we still need to create the normal shift record)
    const { data: shift, error: shiftError } = await adminClient
      .from("shifts")
      .insert({
        business_id: ctx.businessId,
        employee_id: ctx.employeeId,
        date: event.event_date,
        scheduled_start: event.start_time,
        scheduled_finish: event.finish_time,
        location: event.location || null,
        event_id: event.id,
        status: "accepted",
        created_by: ctx.userId,
      })
      .select("*")
      .single();

    if (shiftError) {
      // The atomic function already reserved the position — log the error but don't fail silently
      console.error("Failed to create shift after atomic accept:", shiftError);
      return NextResponse.json({
        error: "Position reserved but shift creation failed. Contact admin.",
      }, { status: 500 });
    }

    // 8. Link shift to recipient record
    await adminClient
      .from("open_shift_offer_recipients")
      .update({ shift_id: shift.id })
      .eq("id", recipientId);

    // 9. Update event status if fully staffed
    if (result.offer_now_filled) {
      // Check if ALL requirements are now filled
      const { data: reqs } = await adminClient
        .from("event_staffing_requirements")
        .select("required_count, filled_count")
        .eq("event_id", event.id);

      const allFilled = reqs?.every((r) => r.filled_count >= r.required_count);
      if (allFilled) {
        await adminClient
          .from("staffing_events")
          .update({ status: "FULLY_STAFFED" })
          .eq("id", event.id);
      } else {
        await adminClient
          .from("staffing_events")
          .update({ status: "PARTIALLY_FILLED" })
          .eq("id", event.id);
      }
    } else {
      // Update to PARTIALLY_FILLED if not already
      if (event.status === "OPEN") {
        await adminClient
          .from("staffing_events")
          .update({ status: "PARTIALLY_FILLED" })
          .eq("id", event.id);
      }
    }

    // 10. Audit log
    await adminClient.from("event_audit_log").insert({
      business_id: ctx.businessId,
      event_id: event.id,
      action: "offer_accepted",
      details: {
        employee_id: ctx.employeeId,
        recipient_id: recipientId,
        shift_id: shift.id,
        positions_filled: result.positions_filled,
        positions_required: result.positions_required,
        offer_now_filled: result.offer_now_filled,
      },
      performed_by: ctx.userId,
    });

    return NextResponse.json({
      success: true,
      action: "accepted",
      shift_id: shift.id,
      positions_filled: result.positions_filled,
      positions_required: result.positions_required,
      fully_staffed: result.offer_now_filled,
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
