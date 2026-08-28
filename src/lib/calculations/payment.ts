import { minutesToDecimalHours } from "./time";

export interface PaymentBreakdown {
  wageAmount: number;
  mileageAmount: number;
  totalAmount: number;
  /** @deprecated Use totalAmount instead */
  estimatedTotal: number;
}

/**
 * Calculates estimated payment for a shift from worked minutes and distance,
 * using rate *snapshots* (never the employee's live current rate) so past
 * timesheets stay correct if rates change later.
 */
export function calculatePayment(
  workedMinutes: number,
  distanceKm: number,
  hourlyRateSnapshot: number,
  mileageRateSnapshot: number
): PaymentBreakdown {
  const hours = minutesToDecimalHours(workedMinutes);
  const wageAmount = round2(hours * hourlyRateSnapshot);
  const mileageAmount = round2(distanceKm * mileageRateSnapshot);
  const totalAmount = round2(wageAmount + mileageAmount);
  return {
    wageAmount,
    mileageAmount,
    totalAmount,
    estimatedTotal: totalAmount, // deprecated alias
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
