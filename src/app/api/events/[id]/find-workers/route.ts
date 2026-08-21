// GET /api/events/[id]/find-workers
// Returns ranked list of workers for an event, including employment type and availability
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

interface WorkerCandidate {
  id: string;
  full_name: string;
  employee_number: string;
  employment_type: string | null;
  open_to_extra_shifts: boolean;
  status: "available" | "partial" | "unavailable" | "conflict";
  reason?: string;
  availabilityWindow?: string;
  weeklyHours: number;
  existingShiftTime?: string;
  alreadyAssigned: boolean;
}

function getMonday(d: Date): string {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d.getFullYear(), d.getMonth(), diff);
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, "0")}-${String(mon.getDate()).padStart(2, "0")}`;
}

function getSunday(mondayStr: string): string {
  const d = new Date(mondayStr + "T00:00:00");
  d.setDate(d.getDate() + 6);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime12(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: eventId } = await params;
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();

    // 1. Get the event + requirements
    const { data: event } = await adminClient
      .from("staffing_events")
      .select("*")
      .eq("id", eventId)
      .eq("business_id", ctx.businessId)
      .single();

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const { data: requirements } = await adminClient
      .from("event_staffing_requirements")
      .select("*")
      .eq("event_id", eventId);

    const req = requirements?.[0];

    // 2. Get all active employees
    const { data: employees } = await adminClient
      .from("employees")
      .select("id, full_name, employee_number, employment_status, employment_type, open_to_extra_shifts")
      .eq("business_id", ctx.businessId)
      .eq("employment_status", "active")
      .order("full_name");

    if (!employees || employees.length === 0) {
      return NextResponse.json({ workers: [], event, requirement: req });
    }

    const employeeIds = employees.map((e) => e.id);
    const eventDate = event.event_date;
    const shiftDate = new Date(eventDate + "T00:00:00");
    const dayOfWeek = shiftDate.getDay();

    // Extract HH:MM from event times
    const eventStartHHMM = new Date(event.start_time).toLocaleTimeString("en-AU", {
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const eventEndHHMM = new Date(event.finish_time).toLocaleTimeString("en-AU", {
      hour: "2-digit", minute: "2-digit", hour12: false,
    });

    // 3. Get availability for the day of week
    const { data: availabilities } = await adminClient
      .from("employee_availability")
      .select("employee_id, day_of_week, is_available, start_time, end_time")
      .in("employee_id", employeeIds)
      .eq("day_of_week", dayOfWeek);

    // 4. Get existing shifts on event date for overlap check
    const shiftStartISO = event.start_time;
    const shiftEndISO = event.finish_time;

    const { data: existingShifts } = await adminClient
      .from("shifts")
      .select("id, employee_id, date, scheduled_start, scheduled_finish, status, event_id")
      .in("employee_id", employeeIds)
      .eq("date", eventDate)
      .not("status", "in", '("cancelled","declined")');

    // 5. Get weekly hours
    const weekMonday = getMonday(shiftDate);
    const weekSunday = getSunday(weekMonday);

    const { data: weekShifts } = await adminClient
      .from("shifts")
      .select("employee_id, scheduled_start, scheduled_finish, status")
      .in("employee_id", employeeIds)
      .gte("date", weekMonday)
      .lte("date", weekSunday)
      .not("status", "in", '("cancelled","declined")');

    const weeklyHoursMap: Record<string, number> = {};
    if (weekShifts) {
      for (const ws of weekShifts) {
        const start = new Date(ws.scheduled_start).getTime();
        const end = new Date(ws.scheduled_finish).getTime();
        const hours = (end - start) / (1000 * 60 * 60);
        weeklyHoursMap[ws.employee_id] = (weeklyHoursMap[ws.employee_id] || 0) + hours;
      }
    }

    // 6. Find employees already assigned to this event
    const alreadyAssignedIds = new Set<string>();
    if (existingShifts) {
      for (const s of existingShifts) {
        if (s.event_id === eventId) {
          alreadyAssignedIds.add(s.employee_id);
        }
      }
    }

    // 7. Build results
    const results: WorkerCandidate[] = [];

    for (const emp of employees) {
      const avail = availabilities?.find((a) => a.employee_id === emp.id);
      const weeklyHours = Math.round((weeklyHoursMap[emp.id] || 0) * 10) / 10;
      const isAlreadyAssigned = alreadyAssignedIds.has(emp.id);

      // Check for overlapping shifts (exclude shifts for THIS event)
      const overlap = existingShifts?.find(
        (s) =>
          s.employee_id === emp.id &&
          s.event_id !== eventId &&
          s.scheduled_start < shiftEndISO &&
          s.scheduled_finish > shiftStartISO
      );

      if (overlap) {
        const overlapStartTime = new Date(overlap.scheduled_start).toLocaleTimeString("en-AU", {
          hour: "2-digit", minute: "2-digit", hour12: false,
        });
        const overlapEndTime = new Date(overlap.scheduled_finish).toLocaleTimeString("en-AU", {
          hour: "2-digit", minute: "2-digit", hour12: false,
        });
        results.push({
          id: emp.id,
          full_name: emp.full_name,
          employee_number: emp.employee_number,
          employment_type: emp.employment_type,
          open_to_extra_shifts: emp.open_to_extra_shifts ?? false,
          status: "conflict",
          reason: `Already rostered ${formatTime12(overlapStartTime)} – ${formatTime12(overlapEndTime)}`,
          existingShiftTime: `${formatTime12(overlapStartTime)} – ${formatTime12(overlapEndTime)}`,
          weeklyHours,
          alreadyAssigned: isAlreadyAssigned,
        });
        continue;
      }

      // Check availability
      if (!avail || !avail.is_available) {
        results.push({
          id: emp.id,
          full_name: emp.full_name,
          employee_number: emp.employee_number,
          employment_type: emp.employment_type,
          open_to_extra_shifts: emp.open_to_extra_shifts ?? false,
          status: "unavailable",
          reason: "Not available on this day",
          weeklyHours,
          alreadyAssigned: isAlreadyAssigned,
        });
        continue;
      }

      // Check time window
      if (avail.start_time && avail.end_time) {
        const availStart = avail.start_time.substring(0, 5);
        const availEnd = avail.end_time.substring(0, 5);

        if (eventStartHHMM < availStart || eventEndHHMM > availEnd) {
          results.push({
            id: emp.id,
            full_name: emp.full_name,
            employee_number: emp.employee_number,
            employment_type: emp.employment_type,
            open_to_extra_shifts: emp.open_to_extra_shifts ?? false,
            status: "partial",
            reason: `Available ${formatTime12(availStart)} – ${formatTime12(availEnd)}`,
            availabilityWindow: `${formatTime12(availStart)} – ${formatTime12(availEnd)}`,
            weeklyHours,
            alreadyAssigned: isAlreadyAssigned,
          });
          continue;
        }
      }

      // Fully available
      results.push({
        id: emp.id,
        full_name: emp.full_name,
        employee_number: emp.employee_number,
        employment_type: emp.employment_type,
        open_to_extra_shifts: emp.open_to_extra_shifts ?? false,
        status: "available",
        reason: "Available full shift",
        weeklyHours,
        alreadyAssigned: isAlreadyAssigned,
      });
    }

    // 8. Sort per spec ranking:
    // 1. Available first, then partial, then unavailable, then conflict
    // 2. Within available: casual+open first, then casual, then part-time, then permanent
    // 3. Lower weekly hours first
    const statusPriority: Record<string, number> = { available: 0, partial: 1, unavailable: 2, conflict: 3 };
    const typePriority = (type: string | null, openExtra: boolean): number => {
      if (type === "CASUAL" && openExtra) return 0;
      if (type === "CASUAL") return 1;
      if (type === "PART_TIME") return 2;
      return 3; // PERMANENT or null
    };

    results.sort((a, b) => {
      // Already assigned go to bottom (they're shown separately)
      if (a.alreadyAssigned !== b.alreadyAssigned) return a.alreadyAssigned ? 1 : -1;
      const sDiff = (statusPriority[a.status] ?? 9) - (statusPriority[b.status] ?? 9);
      if (sDiff !== 0) return sDiff;
      const tDiff = typePriority(a.employment_type, a.open_to_extra_shifts) -
                     typePriority(b.employment_type, b.open_to_extra_shifts);
      if (tDiff !== 0) return tDiff;
      return a.weeklyHours - b.weeklyHours;
    });

    return NextResponse.json({
      workers: results,
      event,
      requirement: req || null,
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
