import { describe, it, expect } from "vitest";
import { createShiftSchema, recurringShiftSchema } from "./shift.schema";
import { checkinSchema, checkoutSchema } from "./attendance.schema";
import { correctionSubmitSchema } from "./timesheet.schema";
import {
  validateImageFile,
  validateImageMagicBytes,
  ALLOWED_IMAGE_TYPES,
} from "./workSession.schema";

// ────────────────────────────────────────────────────────────
// Shift schemas
// ────────────────────────────────────────────────────────────

describe("createShiftSchema", () => {
  it("validates a valid shift", () => {
    const result = createShiftSchema.safeParse({
      date: "2026-08-28",
      startTime: "09:00",
      endTime: "17:00",
      employeeId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid date format", () => {
    const result = createShiftSchema.safeParse({
      date: "28/08/2026",
      startTime: "09:00",
      endTime: "17:00",
      employeeId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid time format", () => {
    const result = createShiftSchema.safeParse({
      date: "2026-08-28",
      startTime: "9:00",
      endTime: "17:00",
      employeeId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid UUID", () => {
    const result = createShiftSchema.safeParse({
      date: "2026-08-28",
      startTime: "09:00",
      endTime: "17:00",
      employeeId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("allows optional fields", () => {
    const result = createShiftSchema.safeParse({
      date: "2026-08-28",
      startTime: "09:00",
      endTime: "17:00",
      employeeId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      location: "Main Office",
      requireOdometer: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("recurringShiftSchema", () => {
  it("validates a preview action", () => {
    const result = recurringShiftSchema.safeParse({
      action: "preview",
      date: "2026-08-28",
      startTime: "09:00",
      endTime: "17:00",
      employeeIds: ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
      recurrenceType: "WEEKLY_END_OF_MONTH",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty employeeIds", () => {
    const result = recurringShiftSchema.safeParse({
      action: "create",
      date: "2026-08-28",
      startTime: "09:00",
      endTime: "17:00",
      employeeIds: [],
      recurrenceType: "NEXT_WEEK",
    });
    expect(result.success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// Attendance schemas
// ────────────────────────────────────────────────────────────

describe("checkinSchema", () => {
  it("validates a valid check-in", () => {
    const result = checkinSchema.safeParse({
      shiftId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      qrToken: "abc123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing qrToken", () => {
    const result = checkinSchema.safeParse({
      shiftId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional GPS coordinates", () => {
    const result = checkinSchema.safeParse({
      shiftId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      qrToken: "abc123",
      latitude: -33.8688,
      longitude: 151.2093,
    });
    expect(result.success).toBe(true);
  });

  it("rejects out-of-range latitude", () => {
    const result = checkinSchema.safeParse({
      shiftId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      qrToken: "abc123",
      latitude: 91,
    });
    expect(result.success).toBe(false);
  });
});

describe("checkoutSchema", () => {
  it("validates a valid checkout", () => {
    const result = checkoutSchema.safeParse({
      shiftId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    });
    expect(result.success).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────
// Timesheet schemas
// ────────────────────────────────────────────────────────────

describe("correctionSubmitSchema", () => {
  it("validates a valid correction", () => {
    const result = correctionSubmitSchema.safeParse({
      corrected_values: {
        actual_start: "2026-08-28T09:00:00Z",
        actual_finish: "2026-08-28T17:00:00Z",
      },
      employee_note: "Corrected start time.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing employee_note", () => {
    const result = correctionSubmitSchema.safeParse({
      corrected_values: { actual_start: "2026-08-28T09:00:00Z" },
      employee_note: "",
    });
    expect(result.success).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// File validation
// ────────────────────────────────────────────────────────────

describe("validateImageFile", () => {
  it("accepts JPEG files under size limit", () => {
    const file = new File([new Uint8Array(1000)], "photo.jpg", { type: "image/jpeg" });
    expect(validateImageFile(file)).toBeNull();
  });

  it("rejects oversized files", () => {
    const file = new File([new Uint8Array(11 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });
    expect(validateImageFile(file)).toContain("too large");
  });

  it("rejects non-image MIME types", () => {
    const file = new File([new Uint8Array(100)], "doc.pdf", { type: "application/pdf" });
    expect(validateImageFile(file)).toContain("Invalid file type");
  });

  it("accepts all allowed types", () => {
    for (const type of ALLOWED_IMAGE_TYPES) {
      const file = new File([new Uint8Array(100)], `test.${type.split("/")[1]}`, { type });
      expect(validateImageFile(file)).toBeNull();
    }
  });
});

describe("validateImageMagicBytes", () => {
  it("accepts JPEG magic bytes", () => {
    const buf = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00]);
    expect(validateImageMagicBytes(buf)).toBe(true);
  });

  it("accepts PNG magic bytes", () => {
    const buf = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D]);
    expect(validateImageMagicBytes(buf)).toBe(true);
  });

  it("accepts WebP magic bytes", () => {
    const buf = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00]);
    expect(validateImageMagicBytes(buf)).toBe(true);
  });

  it("rejects non-image content", () => {
    const buf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // PDF magic
    expect(validateImageMagicBytes(buf)).toBe(false);
  });

  it("rejects empty buffer", () => {
    const buf = new Uint8Array([]);
    expect(validateImageMagicBytes(buf)).toBe(false);
  });
});
