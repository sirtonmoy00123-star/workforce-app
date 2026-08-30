// POST /api/shifts/recurring — preview conflicts OR create recurring shifts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";
import { buildShiftTimestamps, getBusinessTimezone } from "@/lib/calculations/timezone";
import {
  generateRecurringDates,
  buildConflictReport,
  type RecurrenceType,
  type EmployeeInfo,
  type EmployeeDateStatus,
} from "@/lib/services/recurringShift";

export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();

    const body = await request.json();
    const { action } = body;

    if (action === "preview") {
      return handlePreview(body, ctx);
    } else if (action === "create") {
      return handleCreate(body, ctx);
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err) {
    return handleTenantError(err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePreview(body: any, ctx: { businessId: string }) {
  const {
    date,
    startTime,
    endTime,
    employeeIds,
    recurrenceType,
    customEndDate,
    selectedDays,
    maxOccurrences,
  } = body;

  if (!date || !startTime || !endTime || !employeeIds?.length || !recurrenceType) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // Resolve business timezone for overlap checking
  let businessTz: string | null = null;
  try {
    businessTz = await getBusinessTimezone(ctx.businessId);
  } catch {
    // Will fall back to unsafe Date parsing
  }

  // 1. Generate dates
  const dates = generateRecurringDates(
    date,
    recurrenceType as RecurrenceType,
    customEndDate,
    selectedDays,
    maxOccurrences,
  );

  if (dates.length === 0) {
    return NextResponse.json({ error: "No dates generated." }, { status: 400 });
  }

  // 2. Fetch employees — scoped to business
  const { data: employees } = await adminClient
    .from("employees")
    .select("id, full_name, employee_number, employment_status")
    .in("id", employeeIds)
    .eq("business_id", ctx.businessId);

  if (!employees || employees.length === 0) {
    return NextResponse.json({ error: "No valid employees found." }, { status: 400 });
  }

  // 3. Fetch availability for all employees for all relevant days of week
  const daysOfWeek = [...new Set(dates.map((d) => new Date(d + "T00:00:00").getDay()))];
  const { data: availabilities } = await adminClient
    .from("employee_availability")
    .select("employee_id, day_of_week, is_available, start_time, end_time")
    .in("employee_id", employeeIds)
    .in("day_of_week", daysOfWeek);

  // 4. Fetch existing shifts and approved leave in parallel
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  const [shiftsResult, leaveResult] = await Promise.all([
    adminClient
      .from("shifts")
      .select("id, employee_id, date, scheduled_start, scheduled_finish, status")
      .in("employee_id", employeeIds)
      .gte("date", minDate)
      .lte("date", maxDate),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (adminClient as any)
      .from("employee_leave")
      .select("employee_id, leave_type, start_date, end_date, status")
      .in("employee_id", employeeIds)
      .eq("status", "APPROVED")
      .lte("start_date", maxDate)
      .gte("end_date", minDate),
  ]);

  // 5. Build conflict report — pass timezone-safe timestamp builder + leave
  const stampBuilder = businessTz
    ? (d: string, s: string, e: string) => buildShiftTimestamps(d, s, e, businessTz!)
    : undefined;

  const preview = buildConflictReport(
    dates,
    employees as EmployeeInfo[],
    startTime,
    endTime,
    availabilities || [],
    shiftsResult.data || [],
    stampBuilder,
    leaveResult.data || [],
  );

  return NextResponse.json({ success: true, preview });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCreate(body: any, ctx: { businessId: string; userId: string }) {
  const {
    date,
    startTime,
    endTime,
    location,
    instructions,
    employeeIds,
    recurrenceType,
    customEndDate,
    selectedDays,
    maxOccurrences,
    assignments, // EmployeeDateStatus[][] — with skipped/overridden flags
    timezoneOffsetMinutes,
    requireOdometer,
  } = body;

  if (!date || !startTime || !endTime || !employeeIds?.length || !recurrenceType) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // Build timestamps using business timezone (IANA, DST-safe).
  // Falls back to legacy timezoneOffsetMinutes if timezone lookup fails.
  let businessTz: string | null = null;
  try {
    businessTz = await getBusinessTimezone(ctx.businessId);
  } catch {
    // Will use fallback below
  }

  const offsetMin = typeof timezoneOffsetMinutes === "number" ? timezoneOffsetMinutes : 0;
  const sign = offsetMin <= 0 ? "+" : "-";
  const absMin = Math.abs(offsetMin);
  const offH = String(Math.floor(absMin / 60)).padStart(2, "0");
  const offM = String(absMin % 60).padStart(2, "0");
  const tzSuffix = `${sign}${offH}:${offM}`;

  // Generate dates
  const dates = generateRecurringDates(
    date,
    recurrenceType as RecurrenceType,
    customEndDate,
    selectedDays,
    maxOccurrences,
  );

  // Generate a recurring_group_id if more than one date
  const isRecurring = dates.length > 1;
  const recurringGroupId = isRecurring ? crypto.randomUUID() : null;

  // Build the list of shifts to insert
  type ShiftInsert = {
    business_id: string;
    employee_id: string;
    date: string;
    scheduled_start: string;
    scheduled_finish: string;
    location: string | null;
    instructions: string | null;
    status: "pending" | "accepted" | "declined" | "completed" | "cancelled" | "updated_pending";
    recurring_group_id: string | null;
    is_recurring: boolean;
    recurrence_type: "NONE" | "NEXT_WEEK" | "WEEKLY_END_OF_MONTH" | "WEEKLY_CUSTOM_END";
    recurrence_end_date: string | null;
    require_odometer: boolean | null;
    created_by: string;
  };
  const shiftsToInsert: ShiftInsert[] = [];

  for (let dateIdx = 0; dateIdx < dates.length; dateIdx++) {
    const shiftDate = dates[dateIdx];
    let startISO: string;
    let endISO: string;
    if (businessTz) {
      const stamps = buildShiftTimestamps(shiftDate, startTime, endTime, businessTz);
      startISO = stamps.scheduledStart;
      endISO = stamps.scheduledFinish;
    } else {
      startISO = new Date(`${shiftDate}T${startTime}:00${tzSuffix}`).toISOString();
      endISO = new Date(`${shiftDate}T${endTime}:00${tzSuffix}`).toISOString();
    }

    // Determine which employees to include for this date
    for (const empId of employeeIds as string[]) {
      // Check if this assignment was skipped in the review
      if (assignments && assignments[dateIdx]) {
        const empStatus = (assignments[dateIdx] as EmployeeDateStatus[]).find(
          (a) => a.employeeId === empId
        );
        if (empStatus && empStatus.skipped) continue; // admin chose to skip
        if (
          empStatus &&
          (empStatus.status === "conflict" ||
            empStatus.status === "unavailable" ||
            empStatus.status === "inactive") &&
          !empStatus.overridden
        ) {
          continue; // conflict not overridden — skip
        }
      }

      shiftsToInsert.push({
        business_id: ctx.businessId,
        employee_id: empId,
        date: shiftDate,
        scheduled_start: startISO,
        scheduled_finish: endISO,
        location: location || null,
        instructions: instructions || null,
        status: "pending" as const,
        recurring_group_id: recurringGroupId,
        is_recurring: isRecurring,
        recurrence_type: recurrenceType as "NONE" | "NEXT_WEEK" | "WEEKLY_END_OF_MONTH" | "WEEKLY_CUSTOM_END",
        recurrence_end_date: customEndDate || null,
        require_odometer: typeof requireOdometer === "boolean" ? requireOdometer : null,
        created_by: ctx.userId,
      });
    }
  }

  if (shiftsToInsert.length === 0) {
    return NextResponse.json(
      { error: "No valid shifts to create after skipping conflicts." },
      { status: 400 }
    );
  }

  // Insert all shifts in one call (Supabase handles it atomically)
  const { data: createdShifts, error } = await adminClient
    .from("shifts")
    .insert(shiftsToInsert)
    .select("id, employee_id, date, status");

  if (error) {
    console.error("Bulk shift insert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    created: createdShifts?.length || 0,
    shifts: createdShifts,
    recurringGroupId,
  });
}
