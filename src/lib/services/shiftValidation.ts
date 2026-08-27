/**
 * Shared shift validation — used by both Create Shift and Edit Shift.
 * Single source of truth for all shift business rules.
 */

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];    // blocking — must be resolved
  warnings: ValidationIssue[];  // non-blocking — admin can override with reason
}

export interface ValidationIssue {
  type: "employee_inactive" | "availability" | "overlap" | "duplicate" | "invalid_time" | "shift_started" | "shift_completed";
  message: string;
  details?: string;
}

export interface ShiftAssignmentInput {
  employeeId: string;
  date: string;        // YYYY-MM-DD
  startTime: string;   // HH:MM
  endTime: string;     // HH:MM
  location?: string | null;
  instructions?: string | null;
  excludeShiftId?: string;  // when editing, exclude the current shift from overlap check
}

export interface EmployeeData {
  id: string;
  full_name: string;
  employment_status: string;
}

export interface AvailabilityData {
  day_of_week: number;
  is_available: boolean;
  start_time: string | null;
  end_time: string | null;
}

export interface ExistingShiftData {
  id: string;
  employee_id: string;
  date: string;
  scheduled_start: string;
  scheduled_finish: string;
  status: string;
}

export interface AttendanceData {
  shift_id: string;
  attendance_status: string;
}

/**
 * Core validation function used by both create and edit flows.
 * Returns errors (blocking) and warnings (overridable).
 */
export function validateShiftAssignment(
  input: ShiftAssignmentInput,
  employee: EmployeeData,
  availability: AvailabilityData | null,
  existingShifts: ExistingShiftData[],
  attendance?: AttendanceData | null,
  currentShiftStatus?: string
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // 1. Validate time logic
  if (input.endTime <= input.startTime) {
    errors.push({
      type: "invalid_time",
      message: "Finish time must be after start time.",
      details: `Start: ${input.startTime}, Finish: ${input.endTime}`,
    });
  }

  // 2. Check if shift has already started (edit only)
  if (attendance && attendance.attendance_status === "working") {
    errors.push({
      type: "shift_started",
      message: "This shift has already started.",
      details: "Roster details can no longer be edited normally. Use the Timesheet Correction process if the recorded work time needs correction.",
    });
  }

  // 3. Check if shift is completed (edit only)
  if (currentShiftStatus === "completed") {
    errors.push({
      type: "shift_completed",
      message: "This shift has been completed.",
      details: "Use Timesheet Correction to change actual working records.",
    });
  }

  // 4. Employee active status
  if (employee.employment_status !== "active") {
    errors.push({
      type: "employee_inactive",
      message: `${employee.full_name} is inactive.`,
      details: "Cannot assign shifts to inactive employees.",
    });
  }

  // 5. Check availability (warning, not blocking)
  if (!availability || !availability.is_available) {
    warnings.push({
      type: "availability",
      message: `${employee.full_name} is not available on this day.`,
    });
  } else if (availability.start_time && availability.end_time) {
    const availStart = availability.start_time.substring(0, 5);
    const availEnd = availability.end_time.substring(0, 5);

    if (input.startTime < availStart || input.endTime > availEnd) {
      const parts: string[] = [];
      if (input.startTime < availStart) {
        parts.push(`availability starts at ${availStart}`);
      }
      if (input.endTime > availEnd) {
        parts.push(`availability ends at ${availEnd}`);
      }
      warnings.push({
        type: "availability",
        message: `${employee.full_name}'s ${parts.join(" and ")}.`,
        details: `Availability: ${availStart} – ${availEnd}. Shift: ${input.startTime} – ${input.endTime}.`,
      });
    }
  }

  // 6. Check overlapping shifts (warning with override)
  const shiftStart = new Date(`${input.date}T${input.startTime}:00`).toISOString();
  const shiftEnd = new Date(`${input.date}T${input.endTime}:00`).toISOString();

  const overlaps = existingShifts.filter(
    (s) =>
      s.employee_id === input.employeeId &&
      s.date === input.date &&
      s.id !== input.excludeShiftId &&
      !["cancelled", "declined"].includes(s.status) &&
      s.scheduled_start < shiftEnd &&
      s.scheduled_finish > shiftStart
  );

  if (overlaps.length > 0) {
    for (const overlap of overlaps) {
      const overlapStart = new Date(overlap.scheduled_start).toLocaleTimeString(
        "en-AU", { hour: "numeric", minute: "2-digit", hour12: true }
      );
      const overlapEnd = new Date(overlap.scheduled_finish).toLocaleTimeString(
        "en-AU", { hour: "numeric", minute: "2-digit", hour12: true }
      );
      warnings.push({
        type: "overlap",
        message: `Conflicts with existing shift: ${overlapStart} – ${overlapEnd}.`,
        details: `Shift ID: ${overlap.id}`,
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Determines whether a shift change requires the employee to reconfirm.
 * Important changes (date, start time, finish time, location) → true.
 * Minor changes (instructions only) → false.
 */
export function requiresEmployeeReconfirmation(
  original: {
    date: string;
    scheduled_start: string;
    scheduled_finish: string;
    location: string | null;
  },
  updated: {
    date: string;
    startTime: string;
    endTime: string;
    location: string | null;
    /** Pre-computed ISO start timestamp (timezone-adjusted). When provided,
     *  this is compared directly against original.scheduled_start instead of
     *  building an ISO string without timezone (which causes false positives). */
    scheduledStartISO?: string;
    /** Pre-computed ISO finish timestamp (timezone-adjusted). */
    scheduledFinishISO?: string;
  }
): boolean {
  // Date changed
  if (original.date !== updated.date) return true;

  // Start time changed
  if (updated.scheduledStartISO) {
    // Use timezone-adjusted ISO strings for accurate comparison
    if (original.scheduled_start !== updated.scheduledStartISO) return true;
  } else {
    // Fallback: build ISO without timezone (may have false positives on Vercel UTC)
    const newStartISO = new Date(`${updated.date}T${updated.startTime}:00`).toISOString();
    if (original.scheduled_start !== newStartISO) return true;
  }

  // Finish time changed
  if (updated.scheduledFinishISO) {
    if (original.scheduled_finish !== updated.scheduledFinishISO) return true;
  } else {
    const newEndISO = new Date(`${updated.date}T${updated.endTime}:00`).toISOString();
    if (original.scheduled_finish !== newEndISO) return true;
  }

  // Location changed (normalize nulls and empty strings)
  const origLoc = original.location || "";
  const newLoc = updated.location || "";
  if (origLoc !== newLoc) return true;

  return false;
}
