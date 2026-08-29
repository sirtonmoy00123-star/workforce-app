import { describe, it, expect } from "vitest";
import {
  calculateTimesheetValues,
  recalculateForCorrection,
} from "./timesheetService";

describe("calculateTimesheetValues", () => {
  it("calculates a standard 8-hour shift", () => {
    const result = calculateTimesheetValues({
      actualStartAt: "2026-03-15T09:00:00Z",
      actualFinishAt: "2026-03-15T17:00:00Z",
      startOdometer: 50000,
      finishOdometer: 50100,
      hourlyRateSnapshot: 30,
      mileageRateSnapshot: 0.68,
    });

    expect(result.workedMinutes).toBe(480);
    expect(result.distanceKm).toBe(100);
    expect(result.wageAmount).toBe(240);        // 8h × $30
    expect(result.mileageAmount).toBe(68);       // 100km × $0.68
    expect(result.adjustmentAmount).toBe(0);
    expect(result.totalAmount).toBe(308);        // 240 + 68
  });

  it("applies adjustment amount", () => {
    const result = calculateTimesheetValues({
      actualStartAt: "2026-03-15T09:00:00Z",
      actualFinishAt: "2026-03-15T17:00:00Z",
      startOdometer: 50000,
      finishOdometer: 50000,
      hourlyRateSnapshot: 25,
      mileageRateSnapshot: 0,
      adjustmentAmount: 15.50,
    });

    expect(result.wageAmount).toBe(200);         // 8h × $25
    expect(result.adjustmentAmount).toBe(15.50);
    expect(result.totalAmount).toBe(215.50);
  });

  it("applies negative adjustment", () => {
    const result = calculateTimesheetValues({
      actualStartAt: "2026-03-15T09:00:00Z",
      actualFinishAt: "2026-03-15T17:00:00Z",
      startOdometer: 50000,
      finishOdometer: 50000,
      hourlyRateSnapshot: 25,
      mileageRateSnapshot: 0,
      adjustmentAmount: -10,
    });

    expect(result.totalAmount).toBe(190); // 200 - 10
  });

  it("handles zero odometer (no mileage tracking)", () => {
    const result = calculateTimesheetValues({
      actualStartAt: "2026-03-15T09:00:00Z",
      actualFinishAt: "2026-03-15T13:00:00Z",
      startOdometer: 0,
      finishOdometer: 0,
      hourlyRateSnapshot: 20,
      mileageRateSnapshot: 0.68,
    });

    expect(result.distanceKm).toBe(0);
    expect(result.mileageAmount).toBe(0);
    expect(result.wageAmount).toBe(80); // 4h × $20
    expect(result.totalAmount).toBe(80);
  });

  it("rounds monetary values to 2 decimal places", () => {
    const result = calculateTimesheetValues({
      actualStartAt: "2026-03-15T09:00:00Z",
      actualFinishAt: "2026-03-15T09:20:00Z", // 20 min = 0.3333h
      startOdometer: 0,
      finishOdometer: 0,
      hourlyRateSnapshot: 33.33,
      mileageRateSnapshot: 0,
    });

    // 0.3333... × 33.33 = 11.1099... → 11.11
    expect(result.wageAmount).toBe(11.11);
    expect(result.totalAmount).toBe(11.11);
  });
});

describe("recalculateForCorrection", () => {
  it("without scheduled times: produces same base values as calculateTimesheetValues", () => {
    const direct = calculateTimesheetValues({
      actualStartAt: "2026-03-15T09:00:00Z",
      actualFinishAt: "2026-03-15T17:00:00Z",
      startOdometer: 50000,
      finishOdometer: 50050,
      hourlyRateSnapshot: 30,
      mileageRateSnapshot: 0.68,
    });

    const viaCorrection = recalculateForCorrection(
      "2026-03-15T09:00:00Z",
      "2026-03-15T17:00:00Z",
      50000,
      50050,
      30,
      0.68
    );

    // Base fields match
    expect(viaCorrection.workedMinutes).toBe(direct.workedMinutes);
    expect(viaCorrection.wageAmount).toBe(direct.wageAmount);
    expect(viaCorrection.totalAmount).toBe(direct.totalAmount);
    // Payable = actual when no scheduled times (legacy fallback)
    expect(viaCorrection.payableWorkedMinutes).toBe(direct.workedMinutes);
    expect(viaCorrection.payableStartAt).toBe("2026-03-15T09:00:00Z");
    expect(viaCorrection.payableFinishAt).toBe("2026-03-15T17:00:00Z");
  });

  it("recalculates with corrected times", () => {
    const result = recalculateForCorrection(
      "2026-03-15T09:30:00Z",  // corrected start (was 09:00)
      "2026-03-15T17:00:00Z",
      50000,
      50050,
      30,
      0.68
    );

    expect(result.workedMinutes).toBe(450); // 7.5 hours
    expect(result.wageAmount).toBe(225);    // 7.5 × $30
  });

  it("with scheduled times: routes through payable time engine", () => {
    const result = recalculateForCorrection(
      "2026-03-15T08:50:00Z",  // arrived 10 min early
      "2026-03-15T17:00:00Z",
      0,
      0,
      30,
      0,
      "2026-03-15T09:00:00Z",  // scheduled start
      "2026-03-15T17:00:00Z"   // scheduled finish
    );

    // Default policy: payBeforeScheduledStart=false → payable start capped to 09:00
    expect(result.payableStartAt).toBe("2026-03-15T09:00:00.000Z");
    expect(result.payableWorkedMinutes).toBe(480); // 8h payable (not 8h10m)
    expect(result.workedMinutes).toBe(490);        // 8h10m actual
    expect(result.wageAmount).toBe(240);           // 8h × $30
  });

  it("with scheduled times + pay-before-start policy", () => {
    const result = recalculateForCorrection(
      "2026-03-15T08:50:00Z",  // arrived 10 min early
      "2026-03-15T17:00:00Z",
      0,
      0,
      30,
      0,
      "2026-03-15T09:00:00Z",  // scheduled start
      "2026-03-15T17:00:00Z",  // scheduled finish
      {
        rounding: "EXACT_TIME",
        payBeforeScheduledStart: true,
        defaultUnpaidBreakMinutes: 0,
        defaultPaidBreakMinutes: 0,
      }
    );

    // With payBeforeScheduledStart=true, the early 10 min IS payable
    expect(result.payableStartAt).toBe("2026-03-15T08:50:00.000Z");
    expect(result.payableWorkedMinutes).toBe(490); // full 8h10m
  });
});
