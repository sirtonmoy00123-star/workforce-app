import { describe, it, expect } from "vitest";
import { calculateMileage } from "./mileage";

describe("calculateMileage", () => {
  it("calculates distance correctly", () => {
    expect(calculateMileage(50000, 50100)).toBe(100);
  });

  it("returns 0 for same odometer readings", () => {
    expect(calculateMileage(50000, 50000)).toBe(0);
  });

  it("handles small distances", () => {
    expect(calculateMileage(12345, 12346)).toBe(1);
  });

  it("handles large distances", () => {
    expect(calculateMileage(100000, 100500)).toBe(500);
  });

  it("throws if ending is lower than starting", () => {
    expect(() => calculateMileage(50100, 50000)).toThrow(
      "Ending odometer cannot be lower than starting odometer."
    );
  });
});
