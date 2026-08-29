/**
 * Timesheet Service — unified timesheet calculation and generation.
 *
 * This is the ONE calculation path for payroll. No other route
 * should independently calculate wages — they call this service.
 *
 * Used by:
 *  - workSessionService.finishWorkSession() (primary path)
 *  - corrections/submit/route.ts (recalculation after employee correction)
 *  - Future: admin adjustment flow
 */

import { calculateWorkedMinutes } from "@/lib/calculations/time";
import { calculateMileage } from "@/lib/calculations/mileage";
import { calculatePayment, type PaymentBreakdown } from "@/lib/calculations/payment";
import {
  calculatePayableTime,
  DEFAULT_POLICY,
  type PayableTimePolicy,
} from "@/lib/services/payableTime";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface TimesheetCalcInput {
  actualStartAt: string;       // ISO timestamp
  actualFinishAt: string;      // ISO timestamp
  startOdometer: number;
  finishOdometer: number;
  hourlyRateSnapshot: number;
  mileageRateSnapshot: number;
  adjustmentAmount?: number;   // admin adjustment (+/-)
}

export interface TimesheetCalcResult {
  workedMinutes: number;
  distanceKm: number;
  wageAmount: number;
  mileageAmount: number;
  adjustmentAmount: number;
  totalAmount: number;
}

// ────────────────────────────────────────────────────────────
// Core calculation
// ────────────────────────────────────────────────────────────

/**
 * Calculate all timesheet values from inputs.
 * Pure function — no database access.
 *
 * This is the SINGLE source of truth for wage calculation.
 */
export function calculateTimesheetValues(input: TimesheetCalcInput): TimesheetCalcResult {
  const actualStart = new Date(input.actualStartAt);
  const actualFinish = new Date(input.actualFinishAt);

  const workedMinutes = calculateWorkedMinutes(actualStart, actualFinish);
  const distanceKm = calculateMileage(input.startOdometer, input.finishOdometer);
  const payment: PaymentBreakdown = calculatePayment(
    workedMinutes,
    distanceKm,
    input.hourlyRateSnapshot,
    input.mileageRateSnapshot
  );

  const adjustmentAmount = round2(input.adjustmentAmount ?? 0);
  const totalAmount = round2(payment.totalAmount + adjustmentAmount);

  return {
    workedMinutes,
    distanceKm,
    wageAmount: payment.wageAmount,
    mileageAmount: payment.mileageAmount,
    adjustmentAmount,
    totalAmount,
  };
}

/**
 * Recalculate a timesheet after a correction.
 * Routes through the payable time engine so rounding/break
 * policies apply identically to the normal finish flow.
 *
 * @param scheduledStartAt  — the shift's scheduled start (ISO)
 * @param scheduledEndAt    — the shift's scheduled finish (ISO)
 * @param policy            — payable time policy (defaults to EXACT_TIME)
 */
export function recalculateForCorrection(
  correctedStart: string,
  correctedFinish: string,
  correctedStartOdometer: number,
  correctedFinishOdometer: number,
  hourlyRateSnapshot: number,
  mileageRateSnapshot: number,
  scheduledStartAt?: string,
  scheduledEndAt?: string,
  policy?: PayableTimePolicy
): TimesheetCalcResult & {
  payableStartAt: string;
  payableFinishAt: string;
  payableWorkedMinutes: number;
  paidBreakMinutes: number;
  unpaidBreakMinutes: number;
} {
  const distanceKm = calculateMileage(correctedStartOdometer, correctedFinishOdometer);

  // Use payable time engine when scheduled times are available
  if (scheduledStartAt && scheduledEndAt) {
    const payable = calculatePayableTime(
      {
        scheduledStartAt,
        scheduledEndAt,
        actualStartAt: correctedStart,
        actualFinishAt: correctedFinish,
      },
      policy || DEFAULT_POLICY
    );

    const payment: PaymentBreakdown = calculatePayment(
      payable.payableWorkedMinutes,
      distanceKm,
      hourlyRateSnapshot,
      mileageRateSnapshot
    );

    return {
      workedMinutes: payable.actualWorkedMinutes,
      distanceKm,
      wageAmount: payment.wageAmount,
      mileageAmount: payment.mileageAmount,
      adjustmentAmount: 0,
      totalAmount: round2(payment.totalAmount),
      payableStartAt: payable.payableStartAt,
      payableFinishAt: payable.payableFinishAt,
      payableWorkedMinutes: payable.payableWorkedMinutes,
      paidBreakMinutes: payable.paidBreakMinutes,
      unpaidBreakMinutes: payable.unpaidBreakMinutes,
    };
  }

  // Fallback: no scheduled times (legacy corrections) — actual = payable
  const base = calculateTimesheetValues({
    actualStartAt: correctedStart,
    actualFinishAt: correctedFinish,
    startOdometer: correctedStartOdometer,
    finishOdometer: correctedFinishOdometer,
    hourlyRateSnapshot,
    mileageRateSnapshot,
  });

  return {
    ...base,
    payableStartAt: correctedStart,
    payableFinishAt: correctedFinish,
    payableWorkedMinutes: base.workedMinutes,
    paidBreakMinutes: 0,
    unpaidBreakMinutes: 0,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
