import { describe, it, expect } from "vitest";
import { localToUtc, utcToLocal, buildShiftTimestamps } from "./timezone";

describe("localToUtc", () => {
  it("converts Sydney time to UTC (AEDT, UTC+11)", () => {
    // During AEDT (Nov–Apr): Sydney = UTC+11
    const result = localToUtc("2026-01-15", "09:00", "Australia/Sydney");
    // 09:00 AEDT = 22:00 UTC previous day
    expect(result).toBe("2026-01-14T22:00:00.000Z");
  });

  it("converts Sydney time to UTC (AEST, UTC+10)", () => {
    // During AEST (Apr–Oct): Sydney = UTC+10
    const result = localToUtc("2026-07-15", "09:00", "Australia/Sydney");
    // 09:00 AEST = 23:00 UTC previous day
    expect(result).toBe("2026-07-14T23:00:00.000Z");
  });

  it("converts US Eastern time", () => {
    // EDT (Mar–Nov): UTC-4
    const result = localToUtc("2026-06-15", "09:00", "America/New_York");
    expect(result).toBe("2026-06-15T13:00:00.000Z");
  });

  it("handles midnight", () => {
    const result = localToUtc("2026-03-15", "00:00", "Australia/Sydney");
    // 00:00 AEDT = 13:00 UTC previous day
    expect(result).toBe("2026-03-14T13:00:00.000Z");
  });

  it("handles UTC timezone", () => {
    const result = localToUtc("2026-03-15", "14:30", "UTC");
    expect(result).toBe("2026-03-15T14:30:00.000Z");
  });
});

describe("utcToLocal", () => {
  it("converts UTC to Sydney local time", () => {
    const result = utcToLocal("2026-01-14T22:00:00.000Z", "Australia/Sydney");
    expect(result.date).toBe("2026-01-15");
    expect(result.time).toBe("09:00");
  });

  it("returns correct date and time components", () => {
    const result = utcToLocal("2026-07-14T23:00:00.000Z", "Australia/Sydney");
    expect(result.date).toBe("2026-07-15");
    expect(result.time).toBe("09:00");
  });
});

describe("buildShiftTimestamps", () => {
  it("builds same-day shift timestamps", () => {
    const result = buildShiftTimestamps("2026-01-15", "09:00", "17:00", "Australia/Sydney");
    expect(result.scheduledStart).toBe("2026-01-14T22:00:00.000Z");
    expect(result.scheduledFinish).toBe("2026-01-15T06:00:00.000Z");
  });

  it("handles overnight shifts (end time <= start time)", () => {
    const result = buildShiftTimestamps("2026-01-15", "22:00", "06:00", "Australia/Sydney");
    // 22:00 AEDT Jan 15 = 11:00 UTC Jan 15
    // 06:00 AEDT Jan 16 = 19:00 UTC Jan 15
    expect(new Date(result.scheduledFinish).getTime()).toBeGreaterThan(
      new Date(result.scheduledStart).getTime()
    );
  });

  it("handles midnight end time as overnight", () => {
    const result = buildShiftTimestamps("2026-01-15", "18:00", "00:00", "Australia/Sydney");
    // 00:00 <= 18:00 → overnight, end is Jan 16
    expect(new Date(result.scheduledFinish).getTime()).toBeGreaterThan(
      new Date(result.scheduledStart).getTime()
    );
  });

  // ── DST transition tests ────────────────────────────────────

  it("handles Sydney DST spring-forward (first Sunday in October)", () => {
    // 2026-10-04 is the first Sunday in October — clocks jump from 02:00 AEST to 03:00 AEDT
    // A 06:00-14:00 shift on that day: 06:00 AEST = UTC-10h prior, 14:00 AEDT = UTC-11h
    const result = buildShiftTimestamps("2026-10-04", "06:00", "14:00", "Australia/Sydney");
    const startMs = new Date(result.scheduledStart).getTime();
    const endMs = new Date(result.scheduledFinish).getTime();
    // Should be 7 hours of elapsed time (1 hour lost to spring-forward)
    // Actually the shift spans real clock hours: 06:00-14:00 = 8 clock hours, but the day
    // has 23 real hours. The shift itself is before the transition so it's 8 real hours.
    const elapsedMinutes = (endMs - startMs) / 60_000;
    expect(elapsedMinutes).toBeGreaterThan(0);
    expect(elapsedMinutes).toBe(480); // 8 hours - shift is before the 02:00 transition
  });

  it("handles Sydney DST fall-back (first Sunday in April)", () => {
    // 2026-04-05 is the first Sunday in April — clocks go from 03:00 AEDT back to 02:00 AEST
    // A morning shift 06:00-14:00 on that day
    const result = buildShiftTimestamps("2026-04-05", "06:00", "14:00", "Australia/Sydney");
    const startMs = new Date(result.scheduledStart).getTime();
    const endMs = new Date(result.scheduledFinish).getTime();
    const elapsedMinutes = (endMs - startMs) / 60_000;
    expect(elapsedMinutes).toBeGreaterThan(0);
    expect(elapsedMinutes).toBe(480); // 8 hours - shift is after the 03:00 transition
  });

  it("handles Brisbane shift (no DST)", () => {
    // Brisbane is always AEST (UTC+10), no DST transitions
    const result = buildShiftTimestamps("2026-01-15", "09:00", "17:00", "Australia/Brisbane");
    // 09:00 AEST = 23:00 UTC previous day
    expect(result.scheduledStart).toBe("2026-01-14T23:00:00.000Z");
    expect(result.scheduledFinish).toBe("2026-01-15T07:00:00.000Z");
  });

  it("handles Perth shift (AWST, UTC+8)", () => {
    const result = buildShiftTimestamps("2026-01-15", "09:00", "17:00", "Australia/Perth");
    // 09:00 AWST = 01:00 UTC same day
    expect(result.scheduledStart).toBe("2026-01-15T01:00:00.000Z");
    expect(result.scheduledFinish).toBe("2026-01-15T09:00:00.000Z");
  });

  it("overnight shift produces valid 8-hour duration", () => {
    const result = buildShiftTimestamps("2026-08-28", "22:00", "06:00", "Australia/Sydney");
    const startMs = new Date(result.scheduledStart).getTime();
    const endMs = new Date(result.scheduledFinish).getTime();
    const elapsedMinutes = (endMs - startMs) / 60_000;
    expect(elapsedMinutes).toBe(480); // 8 hours
    expect(endMs).toBeGreaterThan(startMs); // never negative
  });
});
