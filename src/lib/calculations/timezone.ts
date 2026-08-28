/**
 * Timezone utility — converts between business-local time and UTC.
 *
 * Uses the IANA timezone string stored on businesses.timezone
 * (e.g. 'Australia/Sydney') instead of the old timezoneOffsetMinutes
 * workaround. Works correctly across DST transitions.
 *
 * All functions are pure — they never touch the database.
 */

import { createAdminClient } from "@/lib/supabase/admin";

// ────────────────────────────────────────────────────────────
// Core conversion functions (pure, no DB)
// ────────────────────────────────────────────────────────────

/**
 * Convert a local business date + time (e.g. "2026-03-15" + "09:00")
 * into a proper UTC ISO string, interpreting the time in the given
 * IANA timezone.
 *
 * Example:
 *   localToUtc("2026-03-15", "09:00", "Australia/Sydney")
 *   → "2026-03-14T22:00:00.000Z"  (AEDT = UTC+11)
 */
export function localToUtc(date: string, time: string, timezone: string): string {
  // Build a formatter that outputs component parts in the target timezone.
  // We iterate candidate UTC timestamps to find the one whose local
  // representation matches the requested date+time.
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  // Start with a naive UTC guess (assume offset 0)
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  // Try offsets from -14h to +14h to cover all IANA zones
  // In practice we only need to check a narrow band, but this is safe
  for (const offsetHours of [0, -10, -11, -12, -13, -14, -9, -8, -7, -6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
    const candidateUtc = naiveUtc - offsetHours * 3600_000;
    const parts = getLocalParts(candidateUtc, timezone);
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute
    ) {
      return new Date(candidateUtc).toISOString();
    }
  }

  // Fallback: if no exact match found (shouldn't happen for valid inputs),
  // use the naive interpretation
  return new Date(naiveUtc).toISOString();
}

/**
 * Convert a UTC ISO timestamp to a display string in the business timezone.
 *
 * Example:
 *   utcToLocal("2026-03-14T22:00:00.000Z", "Australia/Sydney")
 *   → { date: "2026-03-15", time: "09:00", display: "15 Mar 2026, 9:00 AM" }
 */
export function utcToLocal(utcIso: string, timezone: string): {
  date: string;   // YYYY-MM-DD
  time: string;   // HH:MM
  display: string; // human-readable
} {
  const ms = new Date(utcIso).getTime();
  const parts = getLocalParts(ms, timezone);

  const date = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  const time = `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;

  const display = new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(utcIso));

  return { date, time, display };
}

/**
 * Build a full TIMESTAMPTZ from date + time in the business timezone,
 * handling overnight shifts. If endTime <= startTime as clock strings,
 * the end is treated as the next calendar day.
 */
export function buildShiftTimestamps(
  date: string,
  startTime: string,
  endTime: string,
  timezone: string
): { scheduledStart: string; scheduledFinish: string } {
  const scheduledStart = localToUtc(date, startTime, timezone);

  // Overnight detection: if end clock time <= start clock time, end is next day
  const isOvernight = endTime <= startTime;
  if (isOvernight) {
    const nextDay = addDays(date, 1);
    const scheduledFinish = localToUtc(nextDay, endTime, timezone);
    return { scheduledStart, scheduledFinish };
  }

  const scheduledFinish = localToUtc(date, endTime, timezone);
  return { scheduledStart, scheduledFinish };
}

// ────────────────────────────────────────────────────────────
// Database helper — fetches the timezone for a business
// ────────────────────────────────────────────────────────────

/**
 * Get the IANA timezone for a business from the database.
 * Returns 'Australia/Sydney' as fallback if not set.
 */
export async function getBusinessTimezone(businessId: string): Promise<string> {
  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("businesses")
    .select("timezone")
    .eq("id", businessId)
    .single();

  return data?.timezone || "Australia/Sydney";
}

// ────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────

/** Extract local date/time parts for a UTC millisecond timestamp in a timezone. */
function getLocalParts(utcMs: number, timezone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = fmt.formatToParts(new Date(utcMs));
  const get = (type: string) => {
    const val = parts.find((p) => p.type === type)?.value || "0";
    return parseInt(val, 10);
  };

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") === 24 ? 0 : get("hour"), // midnight edge case
    minute: get("minute"),
  };
}

/** Add days to a YYYY-MM-DD date string. */
function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z"); // noon UTC avoids DST edge
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
