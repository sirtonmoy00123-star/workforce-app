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
});
