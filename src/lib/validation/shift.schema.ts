/**
 * Shift validation schemas (Zod).
 */
import { z } from "zod";

// ── Common field patterns ────────────────────────────────────

const datePattern = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
const timePattern = z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM");
const uuidPattern = z.string().uuid("Invalid UUID");

// ── Create shift ─────────────────────────────────────────────

export const createShiftSchema = z.object({
  date: datePattern,
  startTime: timePattern,
  endTime: timePattern,
  employeeId: uuidPattern,
  location: z.string().max(500).optional().nullable(),
  instructions: z.string().max(2000).optional().nullable(),
  timezoneOffsetMinutes: z.number().int().min(-720).max(840).optional(),
  requireOdometer: z.boolean().optional().nullable(),
});

// ── Edit shift (preview + update) ────────────────────────────

export const editShiftSchema = z.object({
  date: datePattern,
  startTime: timePattern,
  endTime: timePattern,
  location: z.string().max(500).optional().nullable(),
  instructions: z.string().max(2000).optional().nullable(),
  timezoneOffsetMinutes: z.number().int().min(-720).max(840).optional(),
  requireOdometer: z.boolean().optional().nullable(),
});

// ── Accept / decline ─────────────────────────────────────────

export const acceptDeclineSchema = z.object({
  action: z.enum(["accept", "decline"]),
});

// ── Recurring shift ──────────────────────────────────────────

export const recurringShiftSchema = z.object({
  action: z.enum(["preview", "create"]),
  date: datePattern,
  startTime: timePattern,
  endTime: timePattern,
  employeeIds: z.array(uuidPattern).min(1, "At least one employee required"),
  recurrenceType: z.enum(["NONE", "NEXT_WEEK", "WEEKLY_END_OF_MONTH", "WEEKLY_CUSTOM_END"]),
  customEndDate: datePattern.optional(),
  location: z.string().max(500).optional().nullable(),
  instructions: z.string().max(2000).optional().nullable(),
  requireOdometer: z.boolean().optional().nullable(),
  timezoneOffsetMinutes: z.number().int().min(-720).max(840).optional(),
  assignments: z.array(z.array(z.any())).optional(),
});

export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type EditShiftInput = z.infer<typeof editShiftSchema>;
export type RecurringShiftInput = z.infer<typeof recurringShiftSchema>;
