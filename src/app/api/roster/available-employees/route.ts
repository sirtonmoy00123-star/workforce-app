// GET /api/roster/available-employees?date=YYYY-MM-DD&startTime=HH:MM&endTime=HH:MM
// Returns all active employees ranked by availability for the given date/time
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface AvailableEmployee {
  id: string;
  full_name: string;
  employee_number: string;
  status: "available" | "partial" | "unavailable" | "conflict";
  reason?: string;
  availabilityWindow?: string; // e.g. "2 PM – 7 PM"
  weeklyHours: number; // rostered hours this week
  existingShiftTime?: string; // e.g. "3 PM – 5 PM"
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

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { data: appUser } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", user.id)
      .single();

    if (!appUser || appUser.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const url = new URL(request.url);
    const date = url.searchParams.get("date");
    const startTime = url.searchParams.get("startTime");
    const endTime = url.searchParams.get("endTime");

    if (!date || !startTime || !endTime) {
      return NextResponse.json({ error: "date, startTime, endTime are required" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // 1. Get all active employees
    const { data: employees } = await adminClient
      .from("employees")
      .select("id, full_name, employee_number, employment_status")
      .eq("business_id", appUser.business_id)
      .eq("employment_status", "active")
      .order("full_name");

    if (!employees || employees.length === 0) {
      return NextResponse.json([]);
    }

    const employeeIds = employees.map((e) => e.id);

    // 2. Get availability for the day of week
    const shiftDate = new Date(date + "T00:00:00");
    const dayOfWeek = shiftDate.getDay();

    const { data: availabilities } = await adminClient
      .from("employee_availability")
      .select("employee_id, day_of_week, is_available, start_time, end_time")
      .in("employee_id", employeeIds)
      .eq("day_of_week", dayOfWeek);

    // 3. Get existing shifts on this date for overlap check
    const shiftStartISO = new Date(`${date}T${startTime}:00`).toISOString();
    const shiftEndISO = new Date(`${date}T${endTime}:00`).toISOString();

    const { data: existingShifts } = await adminClient
      .from("shifts")
      .select("id, employee_id, date, scheduled_start, scheduled_finish, status")
      .in("employee_id", employeeIds)
      .eq("date", date)
      .not("status", "in", '("cancelled","declined")');

    // 4. Get weekly hours — all shifts this week for each employee
    const weekMonday = getMonday(shiftDate);
    const weekSunday = getSunday(weekMonday);

    const { data: weekShifts } = await adminClient
      .from("shifts")
      .select("employee_id, scheduled_start, scheduled_finish, status")
      .in("employee_id", employeeIds)
      .gte("date", weekMonday)
      .lte("date", weekSunday)
      .not("status", "in", '("cancelled","declined")');

    // Calculate weekly hours per employee
    const weeklyHoursMap: Record<string, number> = {};
    if (weekShifts) {
      for (const ws of weekShifts) {
        const start = new Date(ws.scheduled_start).getTime();
        const end = new Date(ws.scheduled_finish).getTime();
        const hours = (end - start) / (1000 * 60 * 60);
        weeklyHoursMap[ws.employee_id] = (weeklyHoursMap[ws.employee_id] || 0) + hours;
      }
    }

    // 5. Build results
    const results: AvailableEmployee[] = [];

    for (const emp of employees) {
      const avail = availabilities?.find((a) => a.employee_id === emp.id);
      const weeklyHours = Math.round((weeklyHoursMap[emp.id] || 0) * 10) / 10;

      // Check for overlapping shifts
      const overlap = existingShifts?.find(
        (s) =>
          s.employee_id === emp.id &&
          s.scheduled_start < shiftEndISO &&
          s.scheduled_finish > shiftStartISO
      );

      if (overlap) {
        const overlapStart = formatTime12(
          new Date(overlap.scheduled_start).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false })
        );
        const overlapEnd = formatTime12(
          new Date(overlap.scheduled_finish).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: false })
        );
        results.push({
          id: emp.id,
          full_name: emp.full_name,
          employee_number: emp.employee_number,
          status: "conflict",
          reason: `Already rostered ${overlapStart} – ${overlapEnd}`,
          existingShiftTime: `${overlapStart} – ${overlapEnd}`,
          weeklyHours,
        });
        continue;
      }

      // Check availability
      if (!avail || !avail.is_available) {
        results.push({
          id: emp.id,
          full_name: emp.full_name,
          employee_number: emp.employee_number,
          status: "unavailable",
          reason: "Not available on this day",
          weeklyHours,
        });
        continue;
      }

      // Check time window
      if (avail.start_time && avail.end_time) {
        const availStart = avail.start_time.substring(0, 5);
        const availEnd = avail.end_time.substring(0, 5);

        if (startTime < availStart || endTime > availEnd) {
          // Partially available
          results.push({
            id: emp.id,
            full_name: emp.full_name,
            employee_number: emp.employee_number,
            status: "partial",
            reason: `Available only ${formatTime12(availStart)} – ${formatTime12(availEnd)}`,
            availabilityWindow: `${formatTime12(availStart)} – ${formatTime12(availEnd)}`,
            weeklyHours,
          });
          continue;
        }

        // Fully available with window
        results.push({
          id: emp.id,
          full_name: emp.full_name,
          employee_number: emp.employee_number,
          status: "available",
          availabilityWindow: `${formatTime12(availStart)} – ${formatTime12(availEnd)}`,
          weeklyHours,
        });
        continue;
      }

      // Available all day
      results.push({
        id: emp.id,
        full_name: emp.full_name,
        employee_number: emp.employee_number,
        status: "available",
        reason: "Available all day",
        weeklyHours,
      });
    }

    // Sort: available first, then partial, then unavailable, then conflict
    // Within each group, sort by lower weekly hours first
    const priority: Record<string, number> = { available: 0, partial: 1, unavailable: 2, conflict: 3 };
    results.sort((a, b) => {
      const pDiff = (priority[a.status] ?? 9) - (priority[b.status] ?? 9);
      if (pDiff !== 0) return pDiff;
      return a.weeklyHours - b.weeklyHours;
    });

    return NextResponse.json(results);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
