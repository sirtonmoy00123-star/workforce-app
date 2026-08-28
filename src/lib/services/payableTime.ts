/**
 * Payable Time Policy Engine — determines what portion of
 * actual worked time is payable.
 *
 * Pure function: takes inputs, returns payable values.
 * Never queries the database.
 *
 * Supports:
 *  - Rounding policy (EXACT_TIME, NEAREST_5/10/15/30)
 *  - Early start policy (pay_before_scheduled_start)
 *  - Break deduction (unpaid_break_minutes)
 *  - Late finish capping (future: cap at scheduled_end)
 */

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export type RoundingPolicy =
  | "EXACT_TIME"
  | "NEAREST_5"
  | "NEAREST_10"
  | "NEAREST_15"
  | "NEAREST_30";

export interface PayableTimePolicy {
  /** How to round payable minutes. Default: EXACT_TIME */
  rounding: RoundingPolicy;
  /** Whether to pay for time worked before scheduled start. Default: false */
  payBeforeScheduledStart: boolean;
  /** Default unpaid break minutes to deduct. Default: 0 */
  defaultUnpaidBreakMinutes: number;
  /** Default paid break minutes (informational, not deducted). Default: 0 */
  defaultPaidBreakMinutes: number;
}

export interface PayableTimeInput {
  /** When the shift was scheduled to start (UTC ISO) */
  scheduledStartAt: string;
  /** When the shift was scheduled to end (UTC ISO) */
  scheduledEndAt: string;
  /** When the employee actually started work (UTC ISO) */
  actualStartAt: string;
  /** When the employee actually finished work (UTC ISO) */
  actualFinishAt: string;
  /** Override for unpaid break minutes (null = use policy default) */
  unpaidBreakMinutes?: number | null;
  /** Override for paid break minutes (null = use policy default) */
  paidBreakMinutes?: number | null;
}

export interface PayableTimeResult {
  /** The actual clock-in time, unmodified */
  actualStartAt: string;
  /** The actual clock-out time, unmodified */
  actualFinishAt: string;
  /** The start time used for pay calculation */
  payableStartAt: string;
  /** The finish time used for pay calculation */
  payableFinishAt: string;
  /** Raw minutes between actual start and actual finish */
  actualWorkedMinutes: number;
  /** Minutes used for pay: payable_finish - payable_start - unpaid_breaks, rounded */
  payableWorkedMinutes: number;
  /** Unpaid break minutes deducted */
  unpaidBreakMinutes: number;
  /** Paid break minutes (not deducted, informational) */
  paidBreakMinutes: number;
  /** What rounding was applied */
  roundingApplied: RoundingPolicy;
  /** Any adjustments or warnings */
  adjustments: PayableAdjustment[];
}

export interface PayableAdjustment {
  type: "EARLY_START_CAPPED" | "ROUNDING_APPLIED" | "BREAK_DEDUCTED";
  description: string;
  minutesAdjusted: number;
}

// ────────────────────────────────────────────────────────────
// Default policy
// ────────────────────────────────────────────────────────────

export const DEFAULT_POLICY: PayableTimePolicy = {
  rounding: "EXACT_TIME",
  payBeforeScheduledStart: false,
  defaultUnpaidBreakMinutes: 0,
  defaultPaidBreakMinutes: 0,
};

// ────────────────────────────────────────────────────────────
// Core calculation
// ────────────────────────────────────────────────────────────

/**
 * Calculate payable time from actual worked time + policy.
 *
 * Rules:
 * 1. Start with actual start/finish timestamps
 * 2. If !payBeforeScheduledStart and actual start < scheduled start,
 *    cap payable start at scheduled start
 * 3. Calculate raw payable minutes = payable_finish - payable_start
 * 4. Subtract unpaid break minutes
 * 5. Apply rounding policy
 * 6. Result cannot be negative
 */
export function calculatePayableTime(
  input: PayableTimeInput,
  policy: PayableTimePolicy = DEFAULT_POLICY
): PayableTimeResult {
  const adjustments: PayableAdjustment[] = [];

  const actualStart = new Date(input.actualStartAt).getTime();
  const actualFinish = new Date(input.actualFinishAt).getTime();
  const scheduledStart = new Date(input.scheduledStartAt).getTime();

  // 1. Actual worked minutes (raw, untouched)
  const actualWorkedMinutes = Math.max(0, Math.round((actualFinish - actualStart) / 60_000));

  // 2. Determine payable start
  let payableStartMs = actualStart;
  if (!policy.payBeforeScheduledStart && actualStart < scheduledStart) {
    const cappedMinutes = Math.round((scheduledStart - actualStart) / 60_000);
    payableStartMs = scheduledStart;
    adjustments.push({
      type: "EARLY_START_CAPPED",
      description: `Arrived ${cappedMinutes}min early; payable start capped to scheduled start.`,
      minutesAdjusted: -cappedMinutes,
    });
  }

  // 3. Payable finish = actual finish (no late-finish cap for V1)
  const payableFinishMs = actualFinish;

  // 4. Raw payable minutes before breaks and rounding
  let rawPayableMinutes = Math.max(0, Math.round((payableFinishMs - payableStartMs) / 60_000));

  // 5. Deduct unpaid breaks
  const unpaidBreaks = input.unpaidBreakMinutes ?? policy.defaultUnpaidBreakMinutes;
  const paidBreaks = input.paidBreakMinutes ?? policy.defaultPaidBreakMinutes;

  if (unpaidBreaks > 0) {
    rawPayableMinutes = Math.max(0, rawPayableMinutes - unpaidBreaks);
    adjustments.push({
      type: "BREAK_DEDUCTED",
      description: `${unpaidBreaks}min unpaid break deducted.`,
      minutesAdjusted: -unpaidBreaks,
    });
  }

  // 6. Apply rounding
  let payableWorkedMinutes = rawPayableMinutes;
  if (policy.rounding !== "EXACT_TIME") {
    const before = payableWorkedMinutes;
    payableWorkedMinutes = applyRounding(payableWorkedMinutes, policy.rounding);
    if (payableWorkedMinutes !== before) {
      adjustments.push({
        type: "ROUNDING_APPLIED",
        description: `Rounded from ${before}min to ${payableWorkedMinutes}min (${policy.rounding}).`,
        minutesAdjusted: payableWorkedMinutes - before,
      });
    }
  }

  return {
    actualStartAt: input.actualStartAt,
    actualFinishAt: input.actualFinishAt,
    payableStartAt: new Date(payableStartMs).toISOString(),
    payableFinishAt: new Date(payableFinishMs).toISOString(),
    actualWorkedMinutes,
    payableWorkedMinutes: Math.max(0, payableWorkedMinutes),
    unpaidBreakMinutes: unpaidBreaks,
    paidBreakMinutes: paidBreaks,
    roundingApplied: policy.rounding,
    adjustments,
  };
}

// ────────────────────────────────────────────────────────────
// Rounding helper
// ────────────────────────────────────────────────────────────

function applyRounding(minutes: number, policy: RoundingPolicy): number {
  const intervals: Record<string, number> = {
    NEAREST_5: 5,
    NEAREST_10: 10,
    NEAREST_15: 15,
    NEAREST_30: 30,
  };

  const interval = intervals[policy];
  if (!interval) return minutes;
  return Math.round(minutes / interval) * interval;
}
