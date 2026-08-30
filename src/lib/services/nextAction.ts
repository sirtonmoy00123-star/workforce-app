/**
 * Next Action Engine — 8E
 *
 * Determines the single next action an employee should take for a shift,
 * derived from state and requirements. The employee should not need to
 * understand the underlying modules.
 *
 * getNextShiftAction() returns a single action object with:
 *   - action: the action type
 *   - label: button text
 *   - href: URL to navigate to
 *   - variant: visual style (primary / warning / success / info)
 *   - description: short explanation
 */

export type ShiftActionType =
  | "ACCEPT_DECLINE"
  | "CHECK_IN"
  | "START_SHIFT"
  | "ADD_TASK_PROOF"
  | "FINISH_SHIFT"
  | "CHECK_OUT"
  | "VIEW_TIMESHEET"
  | "WAITING"
  | "NONE";

export type ActionVariant = "primary" | "warning" | "success" | "info" | "muted";

export interface ShiftAction {
  action: ShiftActionType;
  label: string;
  href: string;
  variant: ActionVariant;
  description: string;
  urgent: boolean;
}

export interface ShiftState {
  shiftId: string;
  status: string; // pending, accepted, working, completed, declined, cancelled
  date: string;
  scheduledStart: string;
  scheduledFinish: string;
  // Work session state
  hasWorkSession: boolean;
  workSessionStatus?: string; // "working" | "finished"
  // Attendance state
  hasCheckin?: boolean;
  hasCheckout?: boolean;
  requiresCheckin?: boolean;
  requiresCheckout?: boolean;
  // Task proof
  requiresTaskProof?: boolean;
  hasTaskProof?: boolean;
  taskProofStatus?: string;
  // Timesheet
  timesheetId?: string;
  timesheetStatus?: string;
}

/**
 * Derive the next action for a shift from its current state.
 * This is the single source of truth — no duplicate logic across pages.
 */
export function getNextShiftAction(state: ShiftState): ShiftAction {
  const { shiftId, status } = state;

  // ── Pending → Accept/Decline ─────────────────────────────
  if (status === "pending" || status === "updated_pending") {
    return {
      action: "ACCEPT_DECLINE",
      label: "Accept / Decline",
      href: `/employee/shifts/${shiftId}`,
      variant: "primary",
      description: "You have a new shift assignment",
      urgent: isToday(state.date) || isTomorrow(state.date),
    };
  }

  // ── Working (shift in progress) — check BEFORE accepted fallthrough ──
  // Status stays "accepted" while working; the work session status distinguishes
  if (state.hasWorkSession && state.workSessionStatus === "working") {
    if (state.requiresTaskProof && !state.hasTaskProof) {
      return {
        action: "ADD_TASK_PROOF",
        label: "Add Task Proof",
        href: `/employee/shifts/${shiftId}`,
        variant: "warning",
        description: "Required task proof not yet submitted",
        urgent: true,
      };
    }

    return {
      action: "FINISH_SHIFT",
      label: "Finish Shift",
      href: `/employee/finish-shift/${shiftId}`,
      variant: "primary",
      description: "Complete your shift when done",
      urgent: false,
    };
  }

  // ── Accepted (not yet working) ────────────────────────────
  if (status === "accepted") {
    // If attendance check-in is required and not done
    if (state.requiresCheckin && !state.hasCheckin) {
      const canCheckin = isWithinCheckinWindow(state.scheduledStart);
      return {
        action: "CHECK_IN",
        label: "Check In",
        href: `/employee/checkin/${shiftId}`,
        variant: canCheckin ? "primary" : "info",
        description: canCheckin
          ? "Check in to start your shift"
          : "Check-in will be available soon",
        urgent: canCheckin,
      };
    }

    // Ready to start (either no check-in required, or already checked in)
    const canStart = isWithinStartWindow(state.scheduledStart);
    return {
      action: "START_SHIFT",
      label: "Start Shift",
      href: `/employee/start-shift/${shiftId}`,
      variant: canStart ? "primary" : "info",
      description: canStart
        ? "You're ready to start"
        : `Shift starts at ${formatTimeShort(state.scheduledStart)}`,
      urgent: canStart,
    };
  }

  // ── Finished but checkout required ───────────────────────
  if (state.hasWorkSession && state.workSessionStatus === "finished") {
    if (state.requiresCheckout && !state.hasCheckout) {
      return {
        action: "CHECK_OUT",
        label: "Check Out",
        href: `/employee/checkout/${shiftId}`,
        variant: "warning",
        description: "Don't forget to check out",
        urgent: true,
      };
    }
  }

  // ── Completed → View Timesheet ───────────────────────────
  if (status === "completed") {
    if (state.timesheetId) {
      return {
        action: "VIEW_TIMESHEET",
        label: "View Timesheet",
        href: `/employee/timesheets/${state.timesheetId}`,
        variant: "success",
        description: state.timesheetStatus === "approved"
          ? "Timesheet approved"
          : state.timesheetStatus === "needs_correction"
            ? "Correction requested"
            : "Timesheet submitted",
        urgent: state.timesheetStatus === "needs_correction",
      };
    }
    return {
      action: "NONE",
      label: "Completed",
      href: `/employee/shifts/${shiftId}`,
      variant: "success",
      description: "Shift completed",
      urgent: false,
    };
  }

  // ── Declined/Cancelled ───────────────────────────────────
  if (status === "declined" || status === "cancelled") {
    return {
      action: "NONE",
      label: status === "declined" ? "Declined" : "Cancelled",
      href: `/employee/shifts/${shiftId}`,
      variant: "muted",
      description: `Shift ${status}`,
      urgent: false,
    };
  }

  // ── Default ──────────────────────────────────────────────
  return {
    action: "WAITING",
    label: "View Details",
    href: `/employee/shifts/${shiftId}`,
    variant: "info",
    description: "No action needed right now",
    urgent: false,
  };
}

/**
 * For the employee home: get the most important action across all shifts.
 */
export function getPrimaryAction(shifts: ShiftState[]): ShiftAction | null {
  if (shifts.length === 0) return null;

  const actions = shifts.map((s) => ({
    shift: s,
    action: getNextShiftAction(s),
  }));

  // Priority: urgent first, then by action priority
  const actionPriority: Record<ShiftActionType, number> = {
    FINISH_SHIFT: 0,
    ADD_TASK_PROOF: 1,
    CHECK_OUT: 2,
    START_SHIFT: 3,
    CHECK_IN: 4,
    ACCEPT_DECLINE: 5,
    VIEW_TIMESHEET: 6,
    WAITING: 7,
    NONE: 8,
  };

  actions.sort((a, b) => {
    // Urgent items first
    if (a.action.urgent !== b.action.urgent) return a.action.urgent ? -1 : 1;
    // Then by action priority
    return actionPriority[a.action.action] - actionPriority[b.action.action];
  });

  return actions[0]?.action || null;
}

// ── Helpers ────────────────────────────────────────────────

function isToday(dateStr: string): boolean {
  const today = new Date().toISOString().split("T")[0];
  return dateStr === today;
}

function isTomorrow(dateStr: string): boolean {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return dateStr === tomorrow.toISOString().split("T")[0];
}

function isWithinCheckinWindow(scheduledStart: string): boolean {
  const start = new Date(scheduledStart);
  const now = new Date();
  // Can check in up to 30 minutes before
  const windowStart = new Date(start.getTime() - 30 * 60 * 1000);
  return now >= windowStart;
}

function isWithinStartWindow(scheduledStart: string): boolean {
  const start = new Date(scheduledStart);
  const now = new Date();
  // Can start up to 15 minutes before scheduled start
  const windowStart = new Date(start.getTime() - 15 * 60 * 1000);
  return now >= windowStart;
}

function formatTimeShort(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
