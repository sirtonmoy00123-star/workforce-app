import { describe, it, expect } from "vitest";
import { calculatePayment } from "./payment";

describe("calculatePayment", () => {
  it("calculates wages from hours and hourly rate", () => {
    // 480 minutes = 8 hours, $25/hr
    const result = calculatePayment(480, 0, 25, 0);
    expect(result.wageAmount).toBe(200);
    expect(result.mileageAmount).toBe(0);
    expect(result.totalAmount).toBe(200);
  });

  it("calculates mileage amount", () => {
    const result = calculatePayment(0, 100, 0, 0.68);
    expect(result.wageAmount).toBe(0);
    expect(result.mileageAmount).toBe(68);
    expect(result.totalAmount).toBe(68);
  });

  it("combines wages and mileage", () => {
    // 8 hours @ $30/hr + 50km @ $0.68/km
    const result = calculatePayment(480, 50, 30, 0.68);
    expect(result.wageAmount).toBe(240);
    expect(result.mileageAmount).toBe(34);
    expect(result.totalAmount).toBe(274);
  });

  it("handles partial hours correctly", () => {
    // 90 minutes = 1.5 hours @ $20/hr
    const result = calculatePayment(90, 0, 20, 0);
    expect(result.wageAmount).toBe(30);
  });

  it("rounds to 2 decimal places", () => {
    // 45 minutes = 0.75 hours @ $33.33/hr = 24.9975 → 25.00
    const result = calculatePayment(45, 0, 33.33, 0);
    expect(result.wageAmount).toBe(25);

    // 7km @ $0.68 = 4.76
    const result2 = calculatePayment(0, 7, 0, 0.68);
    expect(result2.mileageAmount).toBe(4.76);
  });

  it("returns 0 for zero inputs", () => {
    const result = calculatePayment(0, 0, 25, 0.68);
    expect(result.wageAmount).toBe(0);
    expect(result.mileageAmount).toBe(0);
    expect(result.totalAmount).toBe(0);
  });

  it("includes deprecated estimatedTotal alias", () => {
    const result = calculatePayment(480, 50, 30, 0.68);
    expect(result.estimatedTotal).toBe(result.totalAmount);
  });

  // ── Phase 5 — rate snapshot tests ──────────────────────────

  it("uses snapshot rate, not current employee rate", () => {
    // Shift was published at $30/hr snapshot. Employee rate later changed to $32.
    // Payment must use $30 (the snapshot), not $32.
    const snapshotRate = 30;
    const result = calculatePayment(480, 0, snapshotRate, 0);
    expect(result.wageAmount).toBe(240); // 8h × $30 = $240, NOT $256
  });

  it("handles rate change scenario end-to-end", () => {
    // Scenario from spec: shift published at $30, employee rate becomes $32
    // Old shift still calculates at $30
    const oldShiftSnapshot = 30;
    const newRate = 32; // not used — snapshot is used

    const oldResult = calculatePayment(480, 0, oldShiftSnapshot, 0);
    const newResult = calculatePayment(480, 0, newRate, 0);

    expect(oldResult.wageAmount).toBe(240);  // $30 × 8h
    expect(newResult.wageAmount).toBe(256);  // $32 × 8h (future shifts)
    expect(oldResult.wageAmount).not.toBe(newResult.wageAmount);
  });

  // ── Phase 5 — currency precision ────────────────────────────

  it("never produces floating point noise (119.999...)", () => {
    // 4 hours @ $30/hr = exactly $120.00
    const result = calculatePayment(240, 0, 30, 0);
    expect(result.wageAmount).toBe(120);
    expect(result.totalAmount).toBe(120);
  });

  it("rounds 1/3 hour correctly to 2 decimals", () => {
    // 20 min = 1/3 hour @ $100/hr = $33.333... → $33.33
    const result = calculatePayment(20, 0, 100, 0);
    expect(result.wageAmount).toBe(33.33);
  });

  it("handles mileage with fractional cents", () => {
    // 3km @ $0.91/km = $2.73
    const result = calculatePayment(0, 3, 0, 0.91);
    expect(result.mileageAmount).toBe(2.73);
  });
});
