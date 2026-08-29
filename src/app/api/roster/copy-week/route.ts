// POST /api/roster/copy-week — copy last week's shifts to current week
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";
import { buildShiftTimestamps, getBusinessTimezone } from "@/lib/calculations/timezone";

interface CopyPreviewShift {
  originalShiftId: string;
  employeeId: string;
  employeeName: string;
  date: string;         // new date
  originalDate: string;
  startTime: string;
  endTime: string;
  location: string | null;
  instructions: string | null;
  status: "ready" | "conflict" | "unavailable" | "inactive";
  reason?: string;
}

function formatDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();

    const body = await request.json();
    const { action, fromWeekStart, toWeekStart } = body;
    // fromWeekStart / toWeekStart = YYYY-MM-DD (Monday)

    if (!fromWeekStart || !toWeekStart) {
      return NextResponse.json({ error: "fromWeekStart and toWeekStart are required" }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Calculate date ranges
    const fromStart = new Date(fromWeekStart + "T00:00:00");
    const fromEnd = new Date(fromStart);
    fromEnd.setDate(fromEnd.getDate() + 6);

    const toStart = new Date(toWeekStart + "T00:00:00");

    // Fetch source week shifts — scoped to business
    const { data: sourceShifts } = await adminClient
      .from("shifts")
      .select("*")
      .eq("business_id", ctx.businessId)
      .gte("date", formatDateStr(fromStart))
      .lte("date", formatDateStr(fromEnd))
      .not("status", "in", '("cancelled","declined")')
      .order("date")
      .order("scheduled_start");

    if (!sourceShifts || sourceShifts.length === 0) {
      return NextResponse.json({ error: "No shifts found in the source week." }, { status: 400 });
    }

    // Get all employee IDs
    const employeeIds = [...new Set(sourceShifts.map((s) => s.employee_id))];

    // Fetch employees
    const { data: employees } = await adminClient
      .from("employees")
      .select("id, full_name, employment_status")
      .in("id", employeeIds);

    const empMap: Record<string, { full_name: string; employment_status: string }> = {};
    (employees || []).forEach((e) => { empMap[e.id] = e; });

    // Fetch availability for all relevant day_of_week values
    const dayOfWeeks = [...new Set(sourceShifts.map((s) => {
      const d = new Date(s.date + "T00:00:00");
      return d.getDay();
    }))];

    const { data: availabilities } = await adminClient
      .from("employee_availability")
      .select("employee_id, day_of_week, is_available, start_time, end_time")
      .in("employee_id", employeeIds)
      .in("day_of_week", dayOfWeeks);

    // Fetch existing shifts in the target week
    const toEnd = new Date(toStart);
    toEnd.setDate(toEnd.getDate() + 6);

    const { data: targetShifts } = await adminClient
      .from("shifts")
      .select("employee_id, date, scheduled_start, scheduled_finish, status")
      .eq("business_id", ctx.businessId)
      .gte("date", formatDateStr(toStart))
      .lte("date", formatDateStr(toEnd))
      .not("status", "in", '("cancelled","declined")');

    // Build preview
    const preview: CopyPreviewShift[] = [];

    for (const shift of sourceShifts) {
      // Calculate the new date (same day of week, target week)
      const origDate = new Date(shift.date + "T00:00:00");
      const dayOffset = Math.round((origDate.getTime() - fromStart.getTime()) / (1000 * 60 * 60 * 24));
      const newDate = new Date(toStart);
      newDate.setDate(newDate.getDate() + dayOffset);
      const newDateStr = formatDateStr(newDate);

      // Extract times
      const startDt = new Date(shift.scheduled_start);
      const endDt = new Date(shift.scheduled_finish);
      const startTimeStr = `${String(startDt.getHours()).padStart(2, "0")}:${String(startDt.getMinutes()).padStart(2, "0")}`;
      const endTimeStr = `${String(endDt.getHours()).padStart(2, "0")}:${String(endDt.getMinutes()).padStart(2, "0")}`;

      const emp = empMap[shift.employee_id];
      if (!emp) continue;

      // Check employee active
      if (emp.employment_status !== "active") {
        preview.push({
          originalShiftId: shift.id,
          employeeId: shift.employee_id,
          employeeName: emp.full_name,
          date: newDateStr,
          originalDate: shift.date,
          startTime: startTimeStr,
          endTime: endTimeStr,
          location: shift.location,
          instructions: shift.instructions,
          status: "inactive",
          reason: "Employee is inactive",
        });
        continue;
      }

      // Check overlap — use business timezone for proper UTC conversion
      let newStartISO: string;
      let newEndISO: string;
      try {
        const tz = await getBusinessTimezone(ctx.businessId);
        const stamps = buildShiftTimestamps(newDateStr, startTimeStr, endTimeStr, tz);
        newStartISO = stamps.scheduledStart;
        newEndISO = stamps.scheduledFinish;
      } catch {
        newStartISO = new Date(`${newDateStr}T${startTimeStr}:00`).toISOString();
        newEndISO = new Date(`${newDateStr}T${endTimeStr}:00`).toISOString();
      }

      const overlap = targetShifts?.find(
        (ts) =>
          ts.employee_id === shift.employee_id &&
          ts.date === newDateStr &&
          ts.scheduled_start < newEndISO &&
          ts.scheduled_finish > newStartISO
      );

      if (overlap) {
        preview.push({
          originalShiftId: shift.id,
          employeeId: shift.employee_id,
          employeeName: emp.full_name,
          date: newDateStr,
          originalDate: shift.date,
          startTime: startTimeStr,
          endTime: endTimeStr,
          location: shift.location,
          instructions: shift.instructions,
          status: "conflict",
          reason: "Already has a shift at this time",
        });
        continue;
      }

      // Check availability
      const dayOfWeek = newDate.getDay();
      const avail = availabilities?.find(
        (a) => a.employee_id === shift.employee_id && a.day_of_week === dayOfWeek
      );

      if (!avail || !avail.is_available) {
        preview.push({
          originalShiftId: shift.id,
          employeeId: shift.employee_id,
          employeeName: emp.full_name,
          date: newDateStr,
          originalDate: shift.date,
          startTime: startTimeStr,
          endTime: endTimeStr,
          location: shift.location,
          instructions: shift.instructions,
          status: "unavailable",
          reason: "Not available on this day",
        });
        continue;
      }

      if (avail.start_time && avail.end_time) {
        const availStart = avail.start_time.substring(0, 5);
        const availEnd = avail.end_time.substring(0, 5);
        if (startTimeStr < availStart || endTimeStr > availEnd) {
          preview.push({
            originalShiftId: shift.id,
            employeeId: shift.employee_id,
            employeeName: emp.full_name,
            date: newDateStr,
            originalDate: shift.date,
            startTime: startTimeStr,
            endTime: endTimeStr,
            location: shift.location,
            instructions: shift.instructions,
            status: "unavailable",
            reason: `Available only ${availStart} – ${availEnd}`,
          });
          continue;
        }
      }

      preview.push({
        originalShiftId: shift.id,
        employeeId: shift.employee_id,
        employeeName: emp.full_name,
        date: newDateStr,
        originalDate: shift.date,
        startTime: startTimeStr,
        endTime: endTimeStr,
        location: shift.location,
        instructions: shift.instructions,
        status: "ready",
      });
    }

    if (action === "preview") {
      const ready = preview.filter((p) => p.status === "ready").length;
      const issues = preview.filter((p) => p.status !== "ready").length;
      return NextResponse.json({
        success: true,
        total: preview.length,
        ready,
        issues,
        shifts: preview,
      });
    }

    if (action === "create") {
      // body.selectedShiftIds: string[] — which shifts to actually create (only ready ones by default)
      const selectedIds: string[] = body.selectedShiftIds || preview.filter((p) => p.status === "ready").map((p) => p.originalShiftId);

      // Build shifts with timezone-safe timestamps
      let copyTz: string | null = null;
      try {
        copyTz = await getBusinessTimezone(ctx.businessId);
      } catch { /* fallback below */ }

      const shiftsToInsert = preview
        .filter((p) => selectedIds.includes(p.originalShiftId) && (p.status === "ready" || body.forceOverride))
        .map((p) => {
          let schedStart: string;
          let schedFinish: string;
          if (copyTz) {
            const stamps = buildShiftTimestamps(p.date, p.startTime, p.endTime, copyTz);
            schedStart = stamps.scheduledStart;
            schedFinish = stamps.scheduledFinish;
          } else {
            schedStart = new Date(`${p.date}T${p.startTime}:00`).toISOString();
            schedFinish = new Date(`${p.date}T${p.endTime}:00`).toISOString();
          }
          return {
            business_id: ctx.businessId,
            employee_id: p.employeeId,
            date: p.date,
            scheduled_start: schedStart,
            scheduled_finish: schedFinish,
            location: p.location,
            instructions: p.instructions,
            status: "pending" as const,
            created_by: ctx.userId,
          };
        });

      if (shiftsToInsert.length === 0) {
        return NextResponse.json({ error: "No shifts to copy." }, { status: 400 });
      }

      const { data: created, error } = await adminClient
        .from("shifts")
        .insert(shiftsToInsert)
        .select("id");

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        created: created?.length || 0,
      });
    }

    return NextResponse.json({ error: "Invalid action. Use 'preview' or 'create'." }, { status: 400 });
  } catch (err) {
    return handleTenantError(err);
  }
}
