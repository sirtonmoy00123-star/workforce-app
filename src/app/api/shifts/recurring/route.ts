// POST /api/shifts/recurring — preview conflicts OR create recurring shifts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateRecurringDates,
  buildConflictReport,
  type RecurrenceType,
  type EmployeeInfo,
  type EmployeeDateStatus,
} from "@/lib/services/recurringShift";

export async function POST(request: Request) {
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

    const body = await request.json();
    const { action } = body;

    if (action === "preview") {
      return handlePreview(body, appUser);
    } else if (action === "create") {
      return handleCreate(body, appUser);
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (err) {
    console.error("Recurring shift error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handlePreview(body: any, appUser: any) {
  const {
    date,
    startTime,
    endTime,
    employeeIds,
    recurrenceType,
    customEndDate,
  } = body;

  if (!date || !startTime || !endTime || !employeeIds?.length || !recurrenceType) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // 1. Generate dates
  const dates = generateRecurringDates(
    date,
    recurrenceType as RecurrenceType,
    customEndDate
  );

  if (dates.length === 0) {
    return NextResponse.json({ error: "No dates generated." }, { status: 400 });
  }

  // 2. Fetch employees
  const { data: employees } = await adminClient
    .from("employees")
    .select("id, full_name, employee_number, employment_status")
    .in("id", employeeIds)
    .eq("business_id", appUser.business_id);

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

  // 4. Fetch existing shifts for all employees in the date range
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];
  const { data: existingShifts } = await adminClient
    .from("shifts")
    .select("id, employee_id, date, scheduled_start, scheduled_finish, status")
    .in("employee_id", employeeIds)
    .gte("date", minDate)
    .lte("date", maxDate);

  // 5. Build conflict report
  const preview = buildConflictReport(
    dates,
    employees as EmployeeInfo[],
    startTime,
    endTime,
    availabilities || [],
    existingShifts || []
  );

  return NextResponse.json({ success: true, preview });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCreate(body: any, appUser: any) {
  const {
    date,
    startTime,
    endTime,
    location,
    instructions,
    employeeIds,
    recurrenceType,
    customEndDate,
    assignments, // EmployeeDateStatus[][] — with skipped/overridden flags
    saveAsDraft,
  } = body;

  if (!date || !startTime || !endTime || !employeeIds?.length || !recurrenceType) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // Generate dates
  const dates = generateRecurringDates(
    date,
    recurrenceType as RecurrenceType,
    customEndDate
  );

  // Generate a recurring_group_id if more than one date
  const isRecurring = dates.length > 1;
  const recurringGroupId = isRecurring ? crypto.randomUUID() : null;

  // Build the list of shifts to insert
  const shiftsToInsert: Array<{
    business_id: string;
    employee_id: string;
    date: string;
    scheduled_start: string;
    scheduled_finish: string;
    location: string | null;
    instructions: string | null;
    status: string;
    recurring_group_id: string | null;
    is_recurring: boolean;
    recurrence_type: string;
    recurrence_end_date: string | null;
    created_by: string;
  }> = [];

  const shiftStatus = saveAsDraft ? "pending" : "pending"; // both are "pending" — draft just doesn't notify

  for (let dateIdx = 0; dateIdx < dates.length; dateIdx++) {
    const shiftDate = dates[dateIdx];
    const startISO = new Date(`${shiftDate}T${startTime}:00`).toISOString();
    const endISO = new Date(`${shiftDate}T${endTime}:00`).toISOString();

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
        business_id: appUser.business_id,
        employee_id: empId,
        date: shiftDate,
        scheduled_start: startISO,
        scheduled_finish: endISO,
        location: location || null,
        instructions: instructions || null,
        status: shiftStatus,
        recurring_group_id: recurringGroupId,
        is_recurring: isRecurring,
        recurrence_type: recurrenceType,
        recurrence_end_date: customEndDate || null,
        created_by: appUser.id,
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
    isDraft: saveAsDraft,
  });
}
