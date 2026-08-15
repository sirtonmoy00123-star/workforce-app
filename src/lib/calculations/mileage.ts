// Mileage calculation from odometer readings.

/**
 * Calculates distance travelled as (endingOdometer - startingOdometer).
 * Throws if the ending reading is lower than the starting reading —
 * callers must validate this and show a correction prompt before finishing a shift.
 */
export function calculateMileage(startingOdometer: number, endingOdometer: number): number {
  if (endingOdometer < startingOdometer) {
    throw new Error("Ending odometer cannot be lower than starting odometer.");
  }
  return endingOdometer - startingOdometer;
}
