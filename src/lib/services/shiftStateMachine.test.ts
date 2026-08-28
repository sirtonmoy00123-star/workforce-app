import { describe, it, expect } from "vitest";
import {
  resolvePhase,
  canAcceptShift,
  canDeclineShift,
  canCheckIn,
  canStartWork,
  canFinishWork,
  canCheckout,
  canGenerateTimesheet,
  isValidTransition,
  type ShiftState,
} from "./shiftStateMachine";

// ────────────────────────────────────────────────────────────
// resolvePhase
// ────────────────────────────────────────────────────────────

describe("resolvePhase", () => {
  it("maps pending shift to PENDING", () => {
    expect(resolvePhase({ shiftStatus: "pending", workSessionStatus: null, hasCheckedIn: false }))
      .toBe("PENDING");
  });

  it("maps accepted shift (no work session) to ACCEPTED", () => {
    expect(resolvePhase({ shiftStatus: "accepted", workSessionStatus: null, hasCheckedIn: false }))
      .toBe("ACCEPTED");
  });

  it("maps accepted + checked-in to CHECKED_IN", () => {
    expect(resolvePhase({ shiftStatus: "accepted", workSessionStatus: null, hasCheckedIn: true }))
      .toBe("CHECKED_IN");
  });

  it("maps accepted + working session to WORKING", () => {
    expect(resolvePhase({ shiftStatus: "accepted", workSessionStatus: "working", hasCheckedIn: false }))
      .toBe("WORKING");
  });

  it("maps accepted + completed session to COMPLETED", () => {
    expect(resolvePhase({ shiftStatus: "accepted", workSessionStatus: "completed", hasCheckedIn: false }))
      .toBe("COMPLETED");
  });

  it("maps accepted + approved session to COMPLETED", () => {
    expect(resolvePhase({ shiftStatus: "accepted", workSessionStatus: "approved", hasCheckedIn: false }))
      .toBe("COMPLETED");
  });

  it("maps completed shift to COMPLETED", () => {
    expect(resolvePhase({ shiftStatus: "completed", workSessionStatus: null, hasCheckedIn: false }))
      .toBe("COMPLETED");
  });

  it("maps declined shift to DECLINED", () => {
    expect(resolvePhase({ shiftStatus: "declined", workSessionStatus: null, hasCheckedIn: false }))
      .toBe("DECLINED");
  });

  it("maps cancelled shift to CANCELLED", () => {
    expect(resolvePhase({ shiftStatus: "cancelled", workSessionStatus: null, hasCheckedIn: false }))
      .toBe("CANCELLED");
  });

  it("maps updated_pending to UPDATED_PENDING", () => {
    expect(resolvePhase({ shiftStatus: "updated_pending", workSessionStatus: null, hasCheckedIn: false }))
      .toBe("UPDATED_PENDING");
  });

  it("fallback: unknown status maps to PENDING", () => {
    expect(resolvePhase({ shiftStatus: "garbage", workSessionStatus: null, hasCheckedIn: false }))
      .toBe("PENDING");
  });
});

// ────────────────────────────────────────────────────────────
// Guard functions
// ────────────────────────────────────────────────────────────

describe("canAcceptShift", () => {
  it("allows accept from PENDING", () => {
    const state: ShiftState = { shiftStatus: "pending", workSessionStatus: null, hasCheckedIn: false };
    expect(canAcceptShift(state).allowed).toBe(true);
  });

  it("allows accept from UPDATED_PENDING", () => {
    const state: ShiftState = { shiftStatus: "updated_pending", workSessionStatus: null, hasCheckedIn: false };
    expect(canAcceptShift(state).allowed).toBe(true);
  });

  it("blocks accept from ACCEPTED", () => {
    const state: ShiftState = { shiftStatus: "accepted", workSessionStatus: null, hasCheckedIn: false };
    const result = canAcceptShift(state);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("ACCEPTED");
  });

  it("blocks accept from DECLINED with specific message", () => {
    const state: ShiftState = { shiftStatus: "declined", workSessionStatus: null, hasCheckedIn: false };
    const result = canAcceptShift(state);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("This shift was declined.");
  });

  it("blocks accept from CANCELLED with specific message", () => {
    const state: ShiftState = { shiftStatus: "cancelled", workSessionStatus: null, hasCheckedIn: false };
    const result = canAcceptShift(state);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("This shift has been cancelled.");
  });
});

describe("canDeclineShift", () => {
  it("allows decline from PENDING", () => {
    const state: ShiftState = { shiftStatus: "pending", workSessionStatus: null, hasCheckedIn: false };
    expect(canDeclineShift(state).allowed).toBe(true);
  });

  it("blocks decline from ACCEPTED", () => {
    const state: ShiftState = { shiftStatus: "accepted", workSessionStatus: null, hasCheckedIn: false };
    expect(canDeclineShift(state).allowed).toBe(false);
  });
});

describe("canCheckIn", () => {
  it("allows check-in from ACCEPTED", () => {
    const state: ShiftState = { shiftStatus: "accepted", workSessionStatus: null, hasCheckedIn: false };
    expect(canCheckIn(state).allowed).toBe(true);
  });

  it("blocks already checked in", () => {
    const state: ShiftState = { shiftStatus: "accepted", workSessionStatus: null, hasCheckedIn: true };
    const result = canCheckIn(state);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("You have already checked in.");
  });

  it("blocks check-in from UPDATED_PENDING", () => {
    const state: ShiftState = { shiftStatus: "updated_pending", workSessionStatus: null, hasCheckedIn: false };
    const result = canCheckIn(state);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("updated");
  });

  it("blocks check-in when working", () => {
    const state: ShiftState = { shiftStatus: "accepted", workSessionStatus: "working", hasCheckedIn: false };
    const result = canCheckIn(state);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Work has already started.");
  });
});

describe("canStartWork", () => {
  it("allows start from ACCEPTED when attendance not required", () => {
    const state: ShiftState = { shiftStatus: "accepted", workSessionStatus: null, hasCheckedIn: false };
    expect(canStartWork(state, false).allowed).toBe(true);
  });

  it("blocks start from ACCEPTED when attendance required", () => {
    const state: ShiftState = { shiftStatus: "accepted", workSessionStatus: null, hasCheckedIn: false };
    const result = canStartWork(state, true);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("You must check in before starting this shift.");
  });

  it("allows start from CHECKED_IN when attendance required", () => {
    const state: ShiftState = { shiftStatus: "accepted", workSessionStatus: null, hasCheckedIn: true };
    expect(canStartWork(state, true).allowed).toBe(true);
  });

  it("blocks start from WORKING", () => {
    const state: ShiftState = { shiftStatus: "accepted", workSessionStatus: "working", hasCheckedIn: true };
    const result = canStartWork(state, false);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Work has already started.");
  });

  it("blocks start from COMPLETED", () => {
    const state: ShiftState = { shiftStatus: "completed", workSessionStatus: null, hasCheckedIn: false };
    expect(canStartWork(state, false).allowed).toBe(false);
  });

  it("blocks start from PENDING", () => {
    const state: ShiftState = { shiftStatus: "pending", workSessionStatus: null, hasCheckedIn: false };
    expect(canStartWork(state, false).allowed).toBe(false);
  });
});

describe("canFinishWork", () => {
  it("allows finish from WORKING", () => {
    const state: ShiftState = { shiftStatus: "accepted", workSessionStatus: "working", hasCheckedIn: true };
    expect(canFinishWork(state).allowed).toBe(true);
  });

  it("blocks finish from ACCEPTED", () => {
    const state: ShiftState = { shiftStatus: "accepted", workSessionStatus: null, hasCheckedIn: false };
    const result = canFinishWork(state);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Work has not been started yet.");
  });

  it("blocks finish from COMPLETED", () => {
    const state: ShiftState = { shiftStatus: "completed", workSessionStatus: null, hasCheckedIn: false };
    expect(canFinishWork(state).allowed).toBe(false);
  });
});

describe("canCheckout", () => {
  it("allows checkout from WORKING", () => {
    const state: ShiftState = { shiftStatus: "accepted", workSessionStatus: "working", hasCheckedIn: true };
    expect(canCheckout(state).allowed).toBe(true);
  });

  it("allows checkout from COMPLETED", () => {
    const state: ShiftState = { shiftStatus: "completed", workSessionStatus: null, hasCheckedIn: true };
    expect(canCheckout(state).allowed).toBe(true);
  });

  it("blocks checkout from ACCEPTED", () => {
    const state: ShiftState = { shiftStatus: "accepted", workSessionStatus: null, hasCheckedIn: false };
    expect(canCheckout(state).allowed).toBe(false);
  });
});

describe("canGenerateTimesheet", () => {
  it("allows from COMPLETED", () => {
    const state: ShiftState = { shiftStatus: "completed", workSessionStatus: null, hasCheckedIn: false };
    expect(canGenerateTimesheet(state).allowed).toBe(true);
  });

  it("blocks from WORKING", () => {
    const state: ShiftState = { shiftStatus: "accepted", workSessionStatus: "working", hasCheckedIn: true };
    const result = canGenerateTimesheet(state);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Shift is still in progress.");
  });
});

// ────────────────────────────────────────────────────────────
// Transition validation
// ────────────────────────────────────────────────────────────

describe("isValidTransition", () => {
  it("allows pending → accepted", () => {
    expect(isValidTransition("pending", "accepted")).toBe(true);
  });

  it("allows pending → declined", () => {
    expect(isValidTransition("pending", "declined")).toBe(true);
  });

  it("allows pending → cancelled", () => {
    expect(isValidTransition("pending", "cancelled")).toBe(true);
  });

  it("blocks completed → anything", () => {
    expect(isValidTransition("completed", "pending")).toBe(false);
    expect(isValidTransition("completed", "cancelled")).toBe(false);
  });

  it("blocks cancelled → anything", () => {
    expect(isValidTransition("cancelled", "pending")).toBe(false);
  });

  it("allows accepted → completed", () => {
    expect(isValidTransition("accepted", "completed")).toBe(true);
  });

  it("allows updated_pending → accepted", () => {
    expect(isValidTransition("updated_pending", "accepted")).toBe(true);
  });

  it("handles unknown from status", () => {
    expect(isValidTransition("nonexistent", "accepted")).toBe(false);
  });
});
