/**
 * Smart Shift Validation — Phase 6A
 *
 * Used by Create Shift, Edit Shift, Publish Roster, Recurring Shifts.
 * Single source of truth for ALL shift business rules.
 *
 * Returns:
 *   errors[]   — hard blocks (must fix)
 *   warnings[] — soft issues (admin can override with reason, audited)
 *
 * IMPORTANT: All time comparisons use pre-computed UTC ISO timestamps
 * (`scheduledStartISO` / `scheduledFinishISO`) derived from the business
 * timezone via `buildShiftTimestamps()`. This ensures correct validation
 * for overnight shifts and avoids timezone-unsafe `new Date(date+time)`.
 */

// ── Types ─────────────────────────────────────────────────────

export type IssueType =
  | "employee_inactive"
  | "cross_tenant"
  | "availability"
  | "leave_conflict"
  | "overlap"
  | "location_conflict"
  | "minimum_rest"
  | "weekly_hours"
  | "overtime"
  | "consecutive_days"
  | "duplicate"
  | "invalid_time"
  | "shift_started"
  | "shift_completed"
  | "employment_restriction";

export interface ValidationIssue {
  type: IssueType;
  message: string;
  details?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];    // blocking — must be resolved
  warnings: ValidationIssue[];  // non-blocking — admin can override with reason
}

export interface ShiftAssignmentInput {
  employeeId: string;
  businessId: string;          // for cross-tenant check
  date: string;                // YYYY-MM-DD
  startTime: string;           // HH:MM
  endTime: string;             // HH:MM
  location?: string | null;
  locationId?: string | null;
  instructions?: string | null;
  excludeShiftId?: string;     // when editing, exclude the current shift from overlap check
  /** Pre-computed UTC ISO start timestamp from buildShiftTimestamps(). */
  scheduledStartISO?: string;
  /** Pre-computed UTC ISO finish timestamp from buildShiftTimestamps(). */
  scheduledFinishISO?: string;
}

export interface EmployeeData {
  id: string;
  business_id: string;
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
  location_id?: string | null;
}

export interface LeaveData {
  id: string;
  leave_type: string;
  start_date: string;      // YYYY-MM-DD
  end_date: string;         // YYYY-MM-DD
  status: string;
}

export interface AttendanceData {
  shift_id: string;
  attendance_status: string;
}

/** Business-level roster policies (configurable per business later) */
export interface RosterPolicy {
  /** Minimum hours between shifts (default: 10) */
  minimumRestHours: number;
  /** Weekly hours threshold for warning (default: 38) */
  weeklyHoursThreshold: number;
  /** Weekly hours hard cap (default: 60) */
  weeklyHoursHardCap: number;
  /** Max consecutive work days before warning (default: 6) */
  maxConsecutiveDays: number;
}

export const DEFAULT_ROSTER_POLICY: RosterPolicy = {
  minimumRestHours: 10,
  weeklyHoursThreshold: 38,
  weeklyHoursHardCap: 60,
  maxConsecutiveDays: 6,
};

// ── Core Validation ───────────────────────────────────────────

/**
 * Core validation function used by create, edit, publish, and recurring flows.
 * Returns errors (blocking) and warnings (overridable).
 *
 * @param input            The shift being validated
 * @param employee         Employee data (nullable for unfilled shifts)
 * @param availability     Employee's availability for the day (nullable)
 * @param existingShifts   All non-cancelled shifts for this employee in the vicinity
 * @param approvedLeave    Approved leave records overlapping the shift date
 * @param weekShifts       All shifts for this employee in the same ISO week (for hours/consecutive checks)
 * @param attendance       Existing attendance for the shift (edit mode)
 * @param currentShiftStatus  Current shift status (edit mode)
 * @param policy           Roster policy overrides
 */
export function validateShiftAssignment(
  input: ShiftAssignmentInput,
  employee: EmployeeData | null,
  availability: AvailabilityData | null,
  existingShifts: ExistingShiftData[],
  approvedLeave?: LeaveData[],
  weekShifts?: ExistingShiftData[],
  attendance?: AttendanceData | null,
  currentShiftStatus?: string,
  policy?: Partial<RosterPolicy>
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const p = { ...DEFAULT_ROSTER_POLICY, ...policy };

  // ── Unfilled shift: skip employee-specific checks ──
  if (!employee) {
    // Only validate time logic for unfilled shifts
    validateTime(input, errors);
    return { valid: errors.length === 0, errors, warnings };
  }

  // ── 1. Invalid timestamps ──
  validateTime(input, errors);

  // ── 2. Shift already started (edit only) ──
  if (attendance && attendance.attendance_status === "working") {
    errors.push({
      type: "shift_started",
      message: "This shift has already started.",
      details: "Roster details can no longer be edited normally. Use the Timesheet Correction process if the recorded work time needs correction.",
    });
  }

  // ── 3. Shift completed (edit only) ──
  if (currentShiftStatus === "completed") {
    errors.push({
      type: "shift_completed",
      message: "This shift has been completed.",
      details: "Use Timesheet Correction to change actual working records.",
    });
  }

  // ── 4. Cross-tenant employee (HARD ERROR) ──
  if (employee.business_id !== input.businessId) {
    errors.push({
      type: "cross_tenant",
      message: "Cannot assign shifts to employees from another business.",
    });
    // Skip remaining checks — cross-tenant is terminal
    return { valid: false, errors, warnings };
  }

  // ── 5. Employee active status (HARD ERROR) ──
  if (employee.employment_status !== "active") {
    errors.push({
      type: "employee_inactive",
      message: `${employee.full_name} is inactive.`,
      details: "Cannot assign shifts to inactive employees.",
    });
  }

  // ── 6. Approved leave conflict (HARD ERROR) ──
  if (approvedLeave && approvedLeave.length > 0) {
    const conflicting = approvedLeave.filter(
      (l) => l.status === "APPROVED" && l.start_date <= input.date && l.end_date >= input.date
    );
    for (const leave of conflicting) {
      errors.push({
        type: "leave_conflict",
        message: `${employee.full_name} is on ${leave.leave_type.toLowerCase()} leave (${leave.start_date} – ${leave.end_date}).`,
        details: `Leave ID: ${leave.id}`,
      });
    }
  }

  // ── 7. Same-time overlapping shift (HARD ERROR for exact overlap, WARNING for partial) ──
  const shiftStart = input.scheduledStartISO || `${input.date}T${input.startTime}:00Z`;
  const shiftEnd = input.scheduledFinishISO || `${input.date}T${input.endTime}:00Z`;

  const overlaps = existingShifts.filter(
    (s) =>
      s.employee_id === input.employeeId &&
      s.id !== input.excludeShiftId &&
      !["cancelled", "declined"].includes(s.status) &&
      s.scheduled_start < shiftEnd &&
      s.scheduled_finish > shiftStart
  );

  if (overlaps.length > 0) {
    for (const overlap of overlaps) {
      const overlapStart = formatTimeDisplay(overlap.scheduled_start);
      const overlapEnd = formatTimeDisplay(overlap.scheduled_finish);
      errors.push({
        type: "overlap",
        message: `Conflicts with existing shift: ${overlapStart} – ${overlapEnd}.`,
        details: `Shift ID: ${overlap.id}`,
      });
    }
  }

  // ── 8. Location conflict: same employee, same time, different location ──
  if (input.locationId) {
    const locationConflicts = existingShifts.filter(
      (s) =>
        s.employee_id === input.employeeId &&
        s.id !== input.excludeShiftId &&
        !["cancelled", "declined"].includes(s.status) &&
        s.location_id &&
        s.location_id !== input.locationId &&
        s.scheduled_start < shiftEnd &&
        s.scheduled_finish > shiftStart
    );
    // Location conflicts are already captured as overlaps above, but this
    // provides a more specific message. In practice overlaps block first.
    if (locationConflicts.length > 0 && overlaps.length === 0) {
      for (const lc of locationConflicts) {
        errors.push({
          type: "location_conflict",
          message: `Employee assigned to a different location at this time.`,
          details: `Conflicting shift ID: ${lc.id}`,
        });
      }
    }
  }

  // ── 9. Availability (WARNING) ──
  if (!availability || !availability.is_available) {
    warnings.push({
      type: "availability",
      message: `${employee.full_name} is not available on this day.`,
    });
  } else if (availability.start_time && availability.end_time) {
    const availStart = availability.start_time.substring(0, 5);
    const availEnd = availability.end_time.substring(0, 5);
    const isOvernight = input.endTime <= input.startTime;

    const parts: string[] = [];
    if (input.startTime < availStart) parts.push(`availability starts at ${availStart}`);
    if (!isOvernight && input.endTime > availEnd) parts.push(`availability ends at ${availEnd}`);

    if (parts.length > 0) {
      warnings.push({
        type: "availability",
        message: `${employee.full_name}'s ${parts.join(" and ")}.`,
        details: `Availability: ${availStart} – ${availEnd}. Shift: ${input.startTime} – ${input.endTime}.`,
      });
    }
  }

  // ── 10. Minimum rest between shifts (WARNING) ──
  if (existingShifts.length > 0) {
    const minRestMs = p.minimumRestHours * 60 * 60 * 1000;
    const newStart = new Date(shiftStart).getTime();
    const newEnd = new Date(shiftEnd).getTime();

    for (const s of existingShifts) {
      if (s.employee_id !== input.employeeId) continue;
      if (s.id === input.excludeShiftId) continue;
      if (["cancelled", "declined"].includes(s.status)) continue;

      const existingStart = new Date(s.scheduled_start).getTime();
      const existingEnd = new Date(s.scheduled_finish).getTime();

      // Gap between shifts (whichever order they are in)
      const gap = Math.max(
        newStart - existingEnd,  // new shift starts after existing ends
        existingStart - newEnd   // existing starts after new ends
      );

      // Only check if shifts don't overlap (overlaps caught above)
      if (gap > 0 && gap < minRestMs) {
        const gapHours = Math.round(gap / (60 * 60 * 1000) * 10) / 10;
        warnings.push({
          type: "minimum_rest",
          message: `Only ${gapHours}h rest between shifts (minimum ${p.minimumRestHours}h recommended).`,
          details: `Adjacent shift on ${s.date}`,
        });
        break; // One warning is enough
      }
    }
  }

  // ── 11. Weekly hours check (WARNING at threshold, HARD ERROR at cap) ──
  if (weekShifts && weekShifts.length > 0) {
    const shiftDurationMinutes = calculateShiftDurationMinutes(shiftStart, shiftEnd);
    const existingWeekMinutes = weekShifts
      .filter((s) => s.employee_id === input.employeeId && s.id !== input.excludeShiftId && !["cancelled", "declined"].includes(s.status))
      .reduce((sum, s) => {
        return sum + calculateShiftDurationMinutes(s.scheduled_start, s.scheduled_finish);
      }, 0);

    const totalWeekMinutes = existingWeekMinutes + shiftDurationMinutes;
    const totalWeekHours = Math.round(totalWeekMinutes / 60 * 10) / 10;

    if (totalWeekHours > p.weeklyHoursHardCap) {
      errors.push({
        type: "weekly_hours",
        message: `Total weekly hours (${totalWeekHours}h) would exceed the ${p.weeklyHoursHardCap}h limit.`,
      });
    } else if (totalWeekHours > p.weeklyHoursThreshold) {
      warnings.push({
        type: "overtime",
        message: `Total weekly hours (${totalWeekHours}h) exceeds ${p.weeklyHoursThreshold}h threshold.`,
        details: "Possible overtime may apply.",
      });
    }
  }

  // ── 12. Consecutive work days (WARNING) ──
  if (weekShifts && weekShifts.length > 0) {
    const workDates = new Set<string>(
      weekShifts
        .filter((s) => s.employee_id === input.employeeId && s.id !== input.excludeShiftId && !["cancelled", "declined"].includes(s.status))
        .map((s) => s.date)
    );
    workDates.add(input.date);

    const consecutive = countMaxConsecutiveDays(Array.from(workDates));
    if (consecutive > p.maxConsecutiveDays) {
      warnings.push({
        type: "consecutive_days",
        message: `${consecutive} consecutive work days (recommended max ${p.maxConsecutiveDays}).`,
        details: "Consider giving the employee a rest day.",
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ── Time validation helper ────────────────────────────────────

function validateTime(input: ShiftAssignmentInput, errors: ValidationIssue[]): void {
  if (input.scheduledStartISO && input.scheduledFinishISO) {
    if (input.scheduledFinishISO <= input.scheduledStartISO) {
      errors.push({
        type: "invalid_time",
        message: "Finish time must be after start time.",
        details: `Start: ${input.startTime}, Finish: ${input.endTime}`,
      });
    }
  } else {
    if (input.endTime === input.startTime) {
      errors.push({
        type: "invalid_time",
        message: "Finish time cannot be the same as start time.",
        details: `Start: ${input.startTime}, Finish: ${input.endTime}`,
      });
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────

function formatTimeDisplay(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function calculateShiftDurationMinutes(startISO: string, endISO: string): number {
  const ms = new Date(endISO).getTime() - new Date(startISO).getTime();
  return Math.max(0, Math.round(ms / 60000));
}

/**
 * Count the maximum number of consecutive calendar days in a sorted set of date strings.
 */
function countMaxConsecutiveDays(dateStrings: string[]): number {
  if (dateStrings.length === 0) return 0;

  const sorted = dateStrings
    .map((d) => new Date(d + "T12:00:00Z").getTime())
    .sort((a, b) => a - b);

  let max = 1;
  let current = 1;
  const oneDay = 86400000;

  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i] - sorted[i - 1];
    if (diff <= oneDay) {
      current++;
      max = Math.max(max, current);
    } else {
      current = 1;
    }
  }

  return max;
}

// ── Reconfirmation Check ──────────────────────────────────────

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
    scheduledStartISO?: string;
    scheduledFinishISO?: string;
  }
): boolean {
  if (original.date !== updated.date) return true;

  if (updated.scheduledStartISO) {
    if (original.scheduled_start !== updated.scheduledStartISO) return true;
  } else {
    const origStartTime = original.scheduled_start.slice(11, 16);
    if (origStartTime !== updated.startTime) return true;
  }

  if (updated.scheduledFinishISO) {
    if (original.scheduled_finish !== updated.scheduledFinishISO) return true;
  } else {
    const origEndTime = original.scheduled_finish.slice(11, 16);
    if (origEndTime !== updated.endTime) return true;
  }

  const origLoc = original.location || "";
  const newLoc = updated.location || "";
  if (origLoc !== newLoc) return true;

  return false;
}

// ── Batch Validation (for roster publish) ─────────────────────

export interface BatchValidationResult {
  valid: boolean;
  shiftResults: {
    shiftId?: string;
    employeeId: string;
    date: string;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
  }[];
  totalErrors: number;
  totalWarnings: number;
}

/**
 * Validate a batch of shifts (used for draft roster publish).
 * Validates each shift individually, plus cross-shift checks.
 */
export function validateBatch(
  shifts: Array<ShiftAssignmentInput & { shiftId?: string }>,
  employees: Map<string, EmployeeData>,
  availabilityMap: Map<string, AvailabilityData>,    // key: `${employeeId}-${dayOfWeek}`
  existingShifts: ExistingShiftData[],
  approvedLeave: LeaveData[],
  weekShifts: ExistingShiftData[],
  policy?: Partial<RosterPolicy>
): BatchValidationResult {
  const results: BatchValidationResult["shiftResults"] = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const shift of shifts) {
    const employee = shift.employeeId ? employees.get(shift.employeeId) ?? null : null;

    const dayOfWeek = new Date(shift.date + "T00:00:00").getDay();
    const availKey = `${shift.employeeId}-${dayOfWeek}`;
    const availability = availabilityMap.get(availKey) ?? null;

    const empLeave = approvedLeave.filter((l) => l.start_date <= shift.date && l.end_date >= shift.date);

    const result = validateShiftAssignment(
      shift,
      employee,
      availability,
      existingShifts,
      empLeave,
      weekShifts,
      null,
      undefined,
      policy
    );

    results.push({
      shiftId: shift.shiftId,
      employeeId: shift.employeeId,
      date: shift.date,
      errors: result.errors,
      warnings: result.warnings,
    });

    totalErrors += result.errors.length;
    totalWarnings += result.warnings.length;
  }

  return {
    valid: totalErrors === 0,
    shiftResults: results,
    totalErrors,
    totalWarnings,
  };
}
