// POST /api/events/[id]/assign — directly assign selected workers to the event
// Creates normal shifts linked to the event, updates filled_count
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
    const { employeeIds } = body;

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

    // 2. Check how many are already filled
    const { data: existingEventShifts } = await adminClient
      .from("shifts")
      .select("id, employee_id")
      .eq("event_id", eventId)
      .eq("business_id", ctx.businessId)
      .not("status", "in", '("cancelled","declined")');

    const currentFilled = existingEventShifts?.length || 0;
    const remaining = req.required_count - currentFilled;

    if (remaining <= 0) {
      return NextResponse.json({ error: "Event is already fully staffed." }, { status: 400 });
    }

    // Don't allow assigning more than remaining positions
    if (employeeIds.length > remaining) {
      return NextResponse.json({
        error: `Only ${remaining} position${remaining !== 1 ? "s" : ""} remaining. You selected ${employeeIds.length}.`,
      }, { status: 400 });
    }

    // 3. Verify all employees are active and in this business
    const { data: employees } = await adminClient
      .from("employees")
      .select("id, full_name, employment_status")
      .eq("business_id", ctx.businessId)
      .in("id", employeeIds);

    if (!employees || employees.length !== employeeIds.length) {
      return NextResponse.json({ error: "One or more employees not found." }, { status: 400 });
    }

    const inactive = employees.filter((e) => e.employment_status !== "active");
    if (inactive.length > 0) {
      return NextResponse.json({
        error: `${inactive.map((e) => e.full_name).join(", ")} ${inactive.length === 1 ? "is" : "are"} not active.`,
      }, { status: 400 });
    }

    // 4. Check for already assigned to this event
    const alreadyAssigned = existingEventShifts?.filter((s) => employeeIds.includes(s.employee_id)) || [];
    if (alreadyAssigned.length > 0) {
      const alreadyNames = employees
        .filter((e) => alreadyAssigned.some((s) => s.employee_id === e.id))
        .map((e) => e.full_name);
      return NextResponse.json({
        error: `${alreadyNames.join(", ")} already assigned to this event.`,
      }, { status: 400 });
    }

    // 5. Check for overlapping shifts
    const { data: dayShifts } = await adminClient
      .from("shifts")
      .select("id, employee_id, scheduled_start, scheduled_finish")
      .in("employee_id", employeeIds)
      .eq("date", event.event_date)
      .not("status", "in", '("cancelled","declined")')
      .not("event_id", "eq", eventId);

    const overlapping = dayShifts?.filter(
      (s) => s.scheduled_start < event.finish_time && s.scheduled_finish > event.start_time
    ) || [];

    if (overlapping.length > 0) {
      const conflictIds = [...new Set(overlapping.map((s) => s.employee_id))];
      const conflictNames = employees
        .filter((e) => conflictIds.includes(e.id))
        .map((e) => e.full_name);
      return NextResponse.json({
        error: `${conflictNames.join(", ")} ${conflictNames.length === 1 ? "has" : "have"} overlapping shifts.`,
      }, { status: 400 });
    }

    // 6. Create shifts for each employee
    const createdShifts = [];
    for (const empId of employeeIds) {
      const { data: shift, error: shiftError } = await adminClient
        .from("shifts")
        .insert({
          business_id: ctx.businessId,
          employee_id: empId,
          date: event.event_date,
          scheduled_start: event.start_time,
          scheduled_finish: event.finish_time,
          location: event.location || null,
          event_id: eventId,
          status: "pending",
          created_by: ctx.userId,
        })
        .select("*")
        .single();

      if (shiftError) {
        return NextResponse.json({ error: `Failed to create shift: ${shiftError.message}` }, { status: 500 });
      }

      createdShifts.push(shift);
    }

    // 7. Update filled_count on requirement
    const newFilled = currentFilled + employeeIds.length;
    await adminClient
      .from("event_staffing_requirements")
      .update({ filled_count: newFilled })
      .eq("id", req.id);

    // 8. Update event status
    let newStatus = event.status;
    if (newFilled >= req.required_count) {
      newStatus = "FULLY_STAFFED";
    } else if (newFilled > 0) {
      newStatus = "PARTIALLY_FILLED";
    }

    if (newStatus !== event.status) {
      await adminClient
        .from("staffing_events")
        .update({ status: newStatus })
        .eq("id", eventId);
    }

    // 9. Audit log
    const assignedNames = employees.map((e) => e.full_name);
    await adminClient.from("event_audit_log").insert({
      business_id: ctx.businessId,
      event_id: eventId,
      action: "workers_assigned",
      details: {
        assigned: assignedNames,
        count: employeeIds.length,
        new_filled: newFilled,
        new_status: newStatus,
      },
      performed_by: ctx.userId,
    });

    return NextResponse.json({
      success: true,
      assigned: employeeIds.length,
      totalFilled: newFilled,
      totalRequired: req.required_count,
      status: newStatus,
      shifts: createdShifts,
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
