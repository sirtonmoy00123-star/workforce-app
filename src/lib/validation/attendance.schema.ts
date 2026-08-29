/**
 * Attendance validation schemas (Zod).
 */
import { z } from "zod";

const uuidPattern = z.string().uuid("Invalid UUID");

// ── Check-in ─────────────────────────────────────────────────

export const checkinSchema = z.object({
  shiftId: uuidPattern,
  qrToken: z.string().min(1, "QR token is required").max(500),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  timezoneOffsetMinutes: z.number().int().min(-720).max(840).optional(),
});

// ── Check-out ────────────────────────────────────────────────

export const checkoutSchema = z.object({
  shiftId: uuidPattern,
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  timezoneOffsetMinutes: z.number().int().min(-720).max(840).optional(),
});

export type CheckinInput = z.infer<typeof checkinSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
