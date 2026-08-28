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
 * Takes the corrected values and produces new totals.
 *
 * Replaces the inline calculation previously in corrections/submit/route.ts.
 */
export function recalculateForCorrection(
  correctedStart: string,
  correctedFinish: string,
  correctedStartOdometer: number,
  correctedFinishOdometer: number,
  hourlyRateSnapshot: number,
  mileageRateSnapshot: number
): TimesheetCalcResult {
  return calculateTimesheetValues({
    actualStartAt: correctedStart,
    actualFinishAt: correctedFinish,
    startOdometer: correctedStartOdometer,
    finishOdometer: correctedFinishOdometer,
    hourlyRateSnapshot,
    mileageRateSnapshot,
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
