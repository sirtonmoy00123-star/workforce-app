/**
 * Shift State Machine — centralized lifecycle transitions.
 *
 * Maps the combined shift.status + work_session.status into a
 * normalized lifecycle phase, and provides guard functions that
 * each API route calls before performing an action.
 *
 * DB enum values are preserved (no schema change needed):
 *   shift_status: pending, accepted, declined, updated_pending, completed, cancelled
 *   work_session status: pending, working, completed, review_required, approved
 */

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

/** The full lifecycle phase, derived from shift + work session state. */
export type LifecyclePhase =
  | "PENDING"          // awaiting employee response
  | "ACCEPTED"         // employee accepted, not yet working
  | "DECLINED"         // employee declined
  | "UPDATED_PENDING"  // admin changed material details, needs re-accept
  | "CHECKED_IN"       // attendance check-in done, work not started
  | "WORKING"          // work session active
  | "COMPLETED"        // shift finished
  | "CANCELLED";       // admin cancelled

export interface ShiftState {
  shiftStatus: string;
  workSessionStatus: string | null;  // null = no work session exists
  hasCheckedIn: boolean;             // attendance_records.checkin_status !== 'NOT_CHECKED_IN'
}

export interface TransitionResult {
  allowed: boolean;
  reason?: string;
}

// ────────────────────────────────────────────────────────────
// Phase resolution
// ────────────────────────────────────────────────────────────

/**
 * Derive the current lifecycle phase from combined state.
 * This is the single source of truth for "where is this shift?"
 */
export function resolvePhase(state: ShiftState): LifecyclePhase {
  const { shiftStatus, workSessionStatus } = state;

  if (shiftStatus === "cancelled") return "CANCELLED";
  if (shiftStatus === "declined") return "DECLINED";
  if (shiftStatus === "completed") return "COMPLETED";
  if (shiftStatus === "updated_pending") return "UPDATED_PENDING";
  if (shiftStatus === "pending") return "PENDING";

  // Shift is accepted — check work session state
  if (shiftStatus === "accepted") {
    if (workSessionStatus === "working") return "WORKING";
    if (workSessionStatus === "completed" || workSessionStatus === "approved") return "COMPLETED";
    if (state.hasCheckedIn) return "CHECKED_IN";
    return "ACCEPTED";
  }

  // Fallback for any unrecognized status
  return "PENDING";
}

// ────────────────────────────────────────────────────────────
// Guard functions — call these before performing actions
// ────────────────────────────────────────────────────────────

/** Can the employee accept this shift? */
export function canAcceptShift(state: ShiftState): TransitionResult {
  const phase = resolvePhase(state);
  if (phase === "PENDING" || phase === "UPDATED_PENDING") {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: phase === "DECLINED"
      ? "This shift was declined."
      : phase === "CANCELLED"
        ? "This shift has been cancelled."
        : `Shift cannot be accepted in its current state (${phase}).`,
  };
}

/** Can the employee decline this shift? */
export function canDeclineShift(state: ShiftState): TransitionResult {
  const phase = resolvePhase(state);
  if (phase === "PENDING" || phase === "UPDATED_PENDING") {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Shift cannot be declined in its current state (${phase}).`,
  };
}

/** Can the employee check in for attendance? */
export function canCheckIn(state: ShiftState): TransitionResult {
  const phase = resolvePhase(state);
  if (phase === "ACCEPTED") {
    return { allowed: true };
  }
  if (phase === "CHECKED_IN") {
    return { allowed: false, reason: "You have already checked in." };
  }
  if (phase === "UPDATED_PENDING") {
    return { allowed: false, reason: "This shift has been updated and needs your confirmation before check-in." };
  }
  if (phase === "WORKING") {
    return { allowed: false, reason: "Work has already started." };
  }
  return {
    allowed: false,
    reason: `Cannot check in for this shift (${phase}).`,
  };
}

/**
 * Can the employee start work (create a work session)?
 * @param attendanceRequired — from attendance_settings for this shift's location
 */
export function canStartWork(state: ShiftState, attendanceRequired: boolean): TransitionResult {
  const phase = resolvePhase(state);

  if (phase === "WORKING") {
    return { allowed: false, reason: "Work has already started." };
  }
  if (phase === "COMPLETED") {
    return { allowed: false, reason: "This shift has already been completed." };
  }
  if (phase === "CANCELLED") {
    return { allowed: false, reason: "This shift has been cancelled." };
  }
  if (phase === "UPDATED_PENDING") {
    return { allowed: false, reason: "This shift has been updated and needs your confirmation first." };
  }
  if (phase === "PENDING" || phase === "DECLINED") {
    return { allowed: false, reason: "Only accepted shifts can be started." };
  }

  // Must be ACCEPTED or CHECKED_IN
  if (attendanceRequired && phase !== "CHECKED_IN") {
    return { allowed: false, reason: "You must check in before starting this shift." };
  }

  return { allowed: true };
}

/** Can the employee finish work (complete the work session)? */
export function canFinishWork(state: ShiftState): TransitionResult {
  const phase = resolvePhase(state);
  if (phase === "WORKING") {
    return { allowed: true };
  }
  if (phase === "COMPLETED") {
    return { allowed: false, reason: "This shift has already been completed." };
  }
  return {
    allowed: false,
    reason: phase === "ACCEPTED" || phase === "CHECKED_IN"
      ? "Work has not been started yet."
      : `Cannot finish work in current state (${phase}).`,
  };
}

/** Can the employee check out (attendance checkout)? */
export function canCheckout(state: ShiftState): TransitionResult {
  const phase = resolvePhase(state);
  // Checkout is allowed during working or after completion
  if (phase === "WORKING" || phase === "COMPLETED") {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Cannot check out in current state (${phase}).`,
  };
}

/** Can admin generate/approve a timesheet? */
export function canGenerateTimesheet(state: ShiftState): TransitionResult {
  const phase = resolvePhase(state);
  if (phase === "COMPLETED") {
    return { allowed: true };
  }
  if (phase === "WORKING") {
    return { allowed: false, reason: "Shift is still in progress." };
  }
  return {
    allowed: false,
    reason: `Cannot generate timesheet in current state (${phase}).`,
  };
}

// ────────────────────────────────────────────────────────────
// Valid transitions table (for documentation and validation)
// ────────────────────────────────────────────────────────────

export const VALID_TRANSITIONS: Record<string, string[]> = {
  pending:         ["accepted", "declined", "cancelled"],
  accepted:        ["updated_pending", "completed", "cancelled"],
  declined:        ["cancelled"],
  updated_pending: ["accepted", "declined", "cancelled"],
  completed:       [], // terminal
  cancelled:       [], // terminal
};

/**
 * Check if a direct shift status transition is valid.
 * Used by admin override actions.
 */
export function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
