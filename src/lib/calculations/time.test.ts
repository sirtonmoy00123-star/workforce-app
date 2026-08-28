import { describe, it, expect } from "vitest";
import {
  calculateWorkedMinutes,
  formatWorkedDuration,
  minutesToDecimalHours,
} from "./time";

describe("calculateWorkedMinutes", () => {
  it("calculates exact hours correctly", () => {
    const start = new Date("2026-03-15T09:00:00Z");
    const finish = new Date("2026-03-15T17:00:00Z");
    expect(calculateWorkedMinutes(start, finish)).toBe(480); // 8 hours
  });

  it("calculates partial hours correctly", () => {
    const start = new Date("2026-03-15T09:00:00Z");
    const finish = new Date("2026-03-15T09:45:00Z");
    expect(calculateWorkedMinutes(start, finish)).toBe(45);
  });

  it("returns 0 for same start and finish", () => {
    const time = new Date("2026-03-15T09:00:00Z");
    expect(calculateWorkedMinutes(time, time)).toBe(0);
  });

  it("rounds to nearest minute", () => {
    const start = new Date("2026-03-15T09:00:00Z");
    const finish = new Date("2026-03-15T09:00:29Z"); // 29 seconds → rounds to 0
    expect(calculateWorkedMinutes(start, finish)).toBe(0);

    const finish2 = new Date("2026-03-15T09:00:31Z"); // 31 seconds → rounds to 1
    expect(calculateWorkedMinutes(start, finish2)).toBe(1);
  });

  it("handles overnight shifts", () => {
    const start = new Date("2026-03-15T22:00:00Z");
    const finish = new Date("2026-03-16T06:00:00Z");
    expect(calculateWorkedMinutes(start, finish)).toBe(480); // 8 hours
  });

  it("throws if finish is before start", () => {
    const start = new Date("2026-03-15T17:00:00Z");
    const finish = new Date("2026-03-15T09:00:00Z");
    expect(() => calculateWorkedMinutes(start, finish)).toThrow(
      "Finish time cannot be before start time."
    );
  });
});

describe("formatWorkedDuration", () => {
  it("formats exact hours", () => {
    expect(formatWorkedDuration(480)).toEqual({
      totalMinutes: 480,
      hours: 8,
      minutes: 0,
    });
  });

  it("formats hours and minutes", () => {
    expect(formatWorkedDuration(510)).toEqual({
      totalMinutes: 510,
      hours: 8,
      minutes: 30,
    });
  });

  it("formats minutes only (under 1 hour)", () => {
    expect(formatWorkedDuration(45)).toEqual({
      totalMinutes: 45,
      hours: 0,
      minutes: 45,
    });
  });

  it("handles 0 minutes", () => {
    expect(formatWorkedDuration(0)).toEqual({
      totalMinutes: 0,
      hours: 0,
      minutes: 0,
    });
  });
});

describe("minutesToDecimalHours", () => {
  it("converts 60 minutes to 1 hour", () => {
    expect(minutesToDecimalHours(60)).toBe(1);
  });

  it("converts 90 minutes to 1.5 hours", () => {
    expect(minutesToDecimalHours(90)).toBe(1.5);
  });

  it("converts 0 minutes to 0 hours", () => {
    expect(minutesToDecimalHours(0)).toBe(0);
  });

  it("handles non-round numbers", () => {
    expect(minutesToDecimalHours(45)).toBeCloseTo(0.75);
    expect(minutesToDecimalHours(20)).toBeCloseTo(0.3333, 4);
  });
});
