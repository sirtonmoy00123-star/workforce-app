/**
 * RecurringShiftService — generates future shift dates, checks conflicts,
 * and bulk-creates recurring shifts.
 */

export type RecurrenceType = "NONE" | "NEXT_WEEK" | "WEEKLY_END_OF_MONTH" | "WEEKLY_CUSTOM_END";

export interface ShiftTemplate {
  date: string;          // YYYY-MM-DD (original date)
  startTime: string;     // HH:MM
  endTime: string;       // HH:MM
  location: string;
  instructions: string;
}

export interface EmployeeInfo {
  id: string;
  full_name: string;
  employee_number: string;
  employment_status: string;
}

export interface EmployeeDateStatus {
  employeeId: string;
  employeeName: string;
  date: string;
  status: "available" | "conflict" | "unavailable" | "inactive";
  conflictReason?: string;
  skipped: boolean;       // admin chose to skip this one
  overridden: boolean;    // admin chose to override the conflict
}

export interface RecurringPreview {
  dates: string[];                      // all generated YYYY-MM-DD dates
  employees: EmployeeDateStatus[][];    // per-date array of employee statuses
  totalShifts: number;                  // dates × employees (before skips)
}

// ─── Date generation ─────────────────────────────────────────

/**
 * Generate the list of dates for a recurring shift.
 */
export function generateRecurringDates(
  originalDate: string,
  recurrenceType: RecurrenceType,
  customEndDate?: string
): string[] {
  if (recurrenceType === "NONE") return [originalDate];

  const start = new Date(originalDate + "T00:00:00");
  const dates: string[] = [originalDate];

  if (recurrenceType === "NEXT_WEEK") {
    const next = new Date(start);
    next.setDate(next.getDate() + 7);
    dates.push(formatDateStr(next));
    return dates;
  }

  // Weekly repetition — figure out end boundary
  let endBoundary: Date;

  if (recurrenceType === "WEEKLY_END_OF_MONTH") {
    // Last day of the month of the original date
    endBoundary = new Date(start.getFullYear(), start.getMonth() + 1, 0); // day 0 = last day of prev month
  } else {
    // WEEKLY_CUSTOM_END
    if (!customEndDate) return [originalDate];
    endBoundary = new Date(customEndDate + "T00:00:00");
    if (endBoundary <= start) return [originalDate];
  }

  let current = new Date(start);
  while (true) {
    current.setDate(current.getDate() + 7);
    if (current > endBoundary) break;
    dates.push(formatDateStr(current));
  }

  return dates;
}

function formatDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Conflict checking (called server-side) ──────────────────

export interface ConflictCheckInput {
  dates: string[];
  employeeIds: string[];
  startTime: string;
  endTime: string;
  businessId: string;
}

/**
 * Availability record from the DB.
 */
export interface AvailabilityRecord {
  employee_id: string;
  day_of_week: number;
  is_available: boolean;
  start_time: string | null;
  end_time: string | null;
}

/**
 * Existing shift record from the DB (used for overlap check).
 */
export interface ExistingShift {
  id: string;
  employee_id: string;
  date: string;
  scheduled_start: string;
  scheduled_finish: string;
  status: string;
}

/**
 * Build the preview/conflict report. This runs server-side with data
 * fetched from Supabase.
 */
export function buildConflictReport(
  dates: string[],
  employees: EmployeeInfo[],
  startTime: string,
  endTime: string,
  availabilities: AvailabilityRecord[],
  existingShifts: ExistingShift[],
  /** Optional timezone-safe timestamp builder. When provided, uses business timezone
   *  instead of unsafe `new Date(date+time)`. Pass `buildShiftTimestamps` bound to the business timezone. */
  buildTimestampsFn?: (date: string, start: string, end: string) => { scheduledStart: string; scheduledFinish: string }
): RecurringPreview {
  const perDateStatuses: EmployeeDateStatus[][] = [];

  for (const date of dates) {
    const dateObj = new Date(date + "T00:00:00");
    const dayOfWeek = dateObj.getDay(); // 0=Sun … 6=Sat

    // Build timestamps for overlap comparison — use timezone-safe builder when available
    let shiftStart: string;
    let shiftEnd: string;
    if (buildTimestampsFn) {
      const stamps = buildTimestampsFn(date, startTime, endTime);
      shiftStart = stamps.scheduledStart;
      shiftEnd = stamps.scheduledFinish;
    } else {
      shiftStart = new Date(`${date}T${startTime}:00`).toISOString();
      shiftEnd = new Date(`${date}T${endTime}:00`).toISOString();
    }

    const dateStatuses: EmployeeDateStatus[] = [];

    for (const emp of employees) {
      // 1. Check inactive
      if (emp.employment_status !== "active") {
        dateStatuses.push({
          employeeId: emp.id,
          employeeName: emp.full_name,
          date,
          status: "inactive",
          conflictReason: "Employee is inactive",
          skipped: false,
          overridden: false,
        });
        continue;
      }

      // 2. Check overlapping shifts
      const overlap = existingShifts.find(
        (s) =>
          s.employee_id === emp.id &&
          s.date === date &&
          !["cancelled", "declined"].includes(s.status) &&
          s.scheduled_start < shiftEnd &&
          s.scheduled_finish > shiftStart
      );

      if (overlap) {
        const overlapStart = new Date(overlap.scheduled_start).toLocaleTimeString(
          "en-AU",
          { hour: "numeric", minute: "2-digit", hour12: true }
        );
        const overlapEnd = new Date(overlap.scheduled_finish).toLocaleTimeString(
          "en-AU",
          { hour: "numeric", minute: "2-digit", hour12: true }
        );
        dateStatuses.push({
          employeeId: emp.id,
          employeeName: emp.full_name,
          date,
          status: "conflict",
          conflictReason: `Existing shift ${overlapStart} – ${overlapEnd}`,
          skipped: false,
          overridden: false,
        });
        continue;
      }

      // 3. Check availability
      const avail = availabilities.find(
        (a) => a.employee_id === emp.id && a.day_of_week === dayOfWeek
      );

      if (!avail || !avail.is_available) {
        dateStatuses.push({
          employeeId: emp.id,
          employeeName: emp.full_name,
          date,
          status: "unavailable",
          conflictReason: "Not available on this day",
          skipped: false,
          overridden: false,
        });
        continue;
      }

      // Check time window
      if (avail.start_time && avail.end_time) {
        const availStart = avail.start_time.substring(0, 5);
        const availEnd = avail.end_time.substring(0, 5);
        if (startTime < availStart || endTime > availEnd) {
          dateStatuses.push({
            employeeId: emp.id,
            employeeName: emp.full_name,
            date,
            status: "unavailable",
            conflictReason: `Available only ${availStart} – ${availEnd}`,
            skipped: false,
            overridden: false,
          });
          continue;
        }
      }

      // 4. All clear
      dateStatuses.push({
        employeeId: emp.id,
        employeeName: emp.full_name,
        date,
        status: "available",
        skipped: false,
        overridden: false,
      });
    }

    perDateStatuses.push(dateStatuses);
  }

  return {
    dates,
    employees: perDateStatuses,
    totalShifts: dates.length * employees.length,
  };
}
