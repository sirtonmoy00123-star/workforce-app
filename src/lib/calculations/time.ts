// Working-time calculation.
// Always work from real timestamps (Date/ISO strings from the DB),
// never from pre-computed decimal hours.

export interface WorkedDuration {
  totalMinutes: number;
  hours: number;
  minutes: number;
}

/**
 * Calculates worked time as (actualFinish - actualStart), in whole minutes.
 * Throws if finish is before start — callers should validate this earlier
 * with a user-facing message rather than letting this throw in production.
 */
export function calculateWorkedMinutes(actualStart: Date, actualFinish: Date): number {
  const diffMs = actualFinish.getTime() - actualStart.getTime();
  if (diffMs < 0) {
    throw new Error("Finish time cannot be before start time.");
  }
  return Math.round(diffMs / 60000);
}

/** Converts total worked minutes into a { hours, minutes } breakdown for display. */
export function formatWorkedDuration(totalMinutes: number): WorkedDuration {
  return {
    totalMinutes,
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
}

/** Converts total worked minutes into decimal hours, for payment calculation only. */
export function minutesToDecimalHours(totalMinutes: number): number {
  return totalMinutes / 60;
}
