import { describe, it, expect } from "vitest";
import {
  calculatePayableTime,
  DEFAULT_POLICY,
  type PayableTimePolicy,
  type PayableTimeInput,
} from "./payableTime";

const baseInput: PayableTimeInput = {
  scheduledStartAt: "2026-03-15T09:00:00Z",
  scheduledEndAt: "2026-03-15T17:00:00Z",
  actualStartAt: "2026-03-15T09:00:00Z",
  actualFinishAt: "2026-03-15T17:00:00Z",
};

describe("calculatePayableTime", () => {
  describe("EXACT_TIME policy (default)", () => {
    it("returns exact minutes when on time", () => {
      const result = calculatePayableTime(baseInput, DEFAULT_POLICY);
      expect(result.actualWorkedMinutes).toBe(480);
      expect(result.payableWorkedMinutes).toBe(480);
      expect(result.adjustments).toHaveLength(0);
    });

    it("caps early start to scheduled start", () => {
      const input: PayableTimeInput = {
        ...baseInput,
        actualStartAt: "2026-03-15T08:45:00Z", // 15 min early
      };
      const result = calculatePayableTime(input, DEFAULT_POLICY);

      expect(result.actualWorkedMinutes).toBe(495); // 8h15m actual
      expect(result.payableWorkedMinutes).toBe(480); // 8h payable
      expect(result.payableStartAt).toBe("2026-03-15T09:00:00.000Z");
      expect(result.adjustments).toHaveLength(1);
      expect(result.adjustments[0].type).toBe("EARLY_START_CAPPED");
      expect(result.adjustments[0].minutesAdjusted).toBe(-15);
    });

    it("pays early start when policy allows", () => {
      const input: PayableTimeInput = {
        ...baseInput,
        actualStartAt: "2026-03-15T08:45:00Z",
      };
      const policy: PayableTimePolicy = {
        ...DEFAULT_POLICY,
        payBeforeScheduledStart: true,
      };
      const result = calculatePayableTime(input, policy);

      expect(result.payableWorkedMinutes).toBe(495);
      expect(result.adjustments).toHaveLength(0);
    });

    it("handles late start (no capping needed)", () => {
      const input: PayableTimeInput = {
        ...baseInput,
        actualStartAt: "2026-03-15T09:15:00Z", // 15 min late
      };
      const result = calculatePayableTime(input, DEFAULT_POLICY);

      expect(result.actualWorkedMinutes).toBe(465);
      expect(result.payableWorkedMinutes).toBe(465);
      expect(result.adjustments).toHaveLength(0);
    });
  });

  describe("break deductions", () => {
    it("deducts unpaid break from policy default", () => {
      const policy: PayableTimePolicy = {
        ...DEFAULT_POLICY,
        defaultUnpaidBreakMinutes: 30,
      };
      const result = calculatePayableTime(baseInput, policy);

      expect(result.actualWorkedMinutes).toBe(480);
      expect(result.payableWorkedMinutes).toBe(450);
      expect(result.unpaidBreakMinutes).toBe(30);
      expect(result.adjustments.find((a) => a.type === "BREAK_DEDUCTED")).toBeTruthy();
    });

    it("uses input override for unpaid break", () => {
      const policy: PayableTimePolicy = {
        ...DEFAULT_POLICY,
        defaultUnpaidBreakMinutes: 30,
      };
      const input: PayableTimeInput = {
        ...baseInput,
        unpaidBreakMinutes: 15, // override policy default
      };
      const result = calculatePayableTime(input, policy);

      expect(result.unpaidBreakMinutes).toBe(15);
      expect(result.payableWorkedMinutes).toBe(465);
    });

    it("tracks paid break minutes without deducting", () => {
      const policy: PayableTimePolicy = {
        ...DEFAULT_POLICY,
        defaultPaidBreakMinutes: 15,
      };
      const result = calculatePayableTime(baseInput, policy);

      expect(result.paidBreakMinutes).toBe(15);
      expect(result.payableWorkedMinutes).toBe(480); // NOT deducted
    });

    it("never goes below 0 payable minutes", () => {
      const policy: PayableTimePolicy = {
        ...DEFAULT_POLICY,
        defaultUnpaidBreakMinutes: 600, // way more than worked
      };
      const result = calculatePayableTime(baseInput, policy);
      expect(result.payableWorkedMinutes).toBe(0);
    });
  });

  describe("rounding policies", () => {
    it("rounds to nearest 15 minutes", () => {
      const input: PayableTimeInput = {
        ...baseInput,
        actualFinishAt: "2026-03-15T17:07:00Z", // 487 min = 480 + 7
      };
      const policy: PayableTimePolicy = {
        ...DEFAULT_POLICY,
        rounding: "NEAREST_15",
      };
      const result = calculatePayableTime(input, policy);

      // 487 min → nearest 15 → 490? No: round(487/15)*15 = round(32.47)*15 = 32*15 = 480
      expect(result.payableWorkedMinutes).toBe(480);
      expect(result.adjustments.find((a) => a.type === "ROUNDING_APPLIED")).toBeTruthy();
    });

    it("rounds to nearest 30 minutes", () => {
      const input: PayableTimeInput = {
        ...baseInput,
        actualFinishAt: "2026-03-15T17:16:00Z", // 496 min
      };
      const policy: PayableTimePolicy = {
        ...DEFAULT_POLICY,
        rounding: "NEAREST_30",
      };
      const result = calculatePayableTime(input, policy);

      // 496 min → round(496/30)*30 = round(16.53)*30 = 17*30 = 510
      expect(result.payableWorkedMinutes).toBe(510);
    });

    it("rounds to nearest 5 minutes", () => {
      const input: PayableTimeInput = {
        ...baseInput,
        actualFinishAt: "2026-03-15T17:03:00Z", // 483 min
      };
      const policy: PayableTimePolicy = {
        ...DEFAULT_POLICY,
        rounding: "NEAREST_5",
      };
      const result = calculatePayableTime(input, policy);

      // 483 → round(483/5)*5 = round(96.6)*5 = 97*5 = 485
      expect(result.payableWorkedMinutes).toBe(485);
    });

    it("does not produce rounding adjustment when no change", () => {
      const policy: PayableTimePolicy = {
        ...DEFAULT_POLICY,
        rounding: "NEAREST_15",
      };
      // 480 is already divisible by 15
      const result = calculatePayableTime(baseInput, policy);
      expect(result.adjustments.find((a) => a.type === "ROUNDING_APPLIED")).toBeUndefined();
    });
  });

  describe("rounding NEAREST_10", () => {
    it("rounds to nearest 10 minutes", () => {
      const input: PayableTimeInput = {
        ...baseInput,
        actualFinishAt: "2026-03-15T17:07:00Z", // 487 min
      };
      const policy: PayableTimePolicy = {
        ...DEFAULT_POLICY,
        rounding: "NEAREST_10",
      };
      const result = calculatePayableTime(input, policy);
      // 487 → round(487/10)*10 = round(48.7)*10 = 49*10 = 490
      expect(result.payableWorkedMinutes).toBe(490);
    });

    it("rounds down when below midpoint", () => {
      const input: PayableTimeInput = {
        ...baseInput,
        actualFinishAt: "2026-03-15T17:04:00Z", // 484 min
      };
      const policy: PayableTimePolicy = {
        ...DEFAULT_POLICY,
        rounding: "NEAREST_10",
      };
      const result = calculatePayableTime(input, policy);
      // 484 → round(484/10)*10 = round(48.4)*10 = 48*10 = 480
      expect(result.payableWorkedMinutes).toBe(480);
    });
  });

  describe("overnight work session", () => {
    it("handles overnight shift payable time correctly", () => {
      const input: PayableTimeInput = {
        scheduledStartAt: "2026-08-28T12:00:00Z",  // 22:00 AEST
        scheduledEndAt: "2026-08-28T20:00:00Z",     // 06:00 AEST next day
        actualStartAt: "2026-08-28T12:00:00Z",
        actualFinishAt: "2026-08-28T20:00:00Z",
      };
      const result = calculatePayableTime(input, DEFAULT_POLICY);
      expect(result.actualWorkedMinutes).toBe(480);
      expect(result.payableWorkedMinutes).toBe(480);
    });

    it("caps early start on overnight shifts", () => {
      const input: PayableTimeInput = {
        scheduledStartAt: "2026-08-28T12:00:00Z",
        scheduledEndAt: "2026-08-28T20:00:00Z",
        actualStartAt: "2026-08-28T11:50:00Z",  // 10 min early
        actualFinishAt: "2026-08-28T20:00:00Z",
      };
      const result = calculatePayableTime(input, DEFAULT_POLICY);
      expect(result.actualWorkedMinutes).toBe(490);
      expect(result.payableWorkedMinutes).toBe(480);
      expect(result.payableStartAt).toBe("2026-08-28T12:00:00.000Z");
    });
  });

  describe("rate snapshot isolation", () => {
    it("payable time is independent of rate values", () => {
      // Payable time engine produces minutes, not money.
      // Rate snapshots are consumed downstream by payment engine.
      // This test verifies the engine returns pure time values.
      const result = calculatePayableTime(baseInput, DEFAULT_POLICY);
      expect(result.payableWorkedMinutes).toBe(480);
      // No rate-related fields exist in the result
      expect(result).not.toHaveProperty("wageAmount");
      expect(result).not.toHaveProperty("totalAmount");
    });
  });

  describe("combined policies", () => {
    it("applies early cap + break deduction + rounding together", () => {
      const input: PayableTimeInput = {
        ...baseInput,
        actualStartAt: "2026-03-15T08:50:00Z", // 10 min early
        actualFinishAt: "2026-03-15T17:08:00Z", // 8 min late
      };
      const policy: PayableTimePolicy = {
        rounding: "NEAREST_15",
        payBeforeScheduledStart: false,
        defaultUnpaidBreakMinutes: 30,
        defaultPaidBreakMinutes: 0,
      };
      const result = calculatePayableTime(input, policy);

      // Actual: 08:50 → 17:08 = 498 min
      expect(result.actualWorkedMinutes).toBe(498);
      // Payable start capped to 09:00, so 09:00 → 17:08 = 488 min
      // Minus 30 min break = 458 min
      // Round to nearest 15: round(458/15)*15 = round(30.53)*15 = 31*15 = 465
      expect(result.payableWorkedMinutes).toBe(465);
      expect(result.adjustments).toHaveLength(3);
    });
  });
});
