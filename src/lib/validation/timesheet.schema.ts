/**
 * Timesheet validation schemas (Zod).
 */
import { z } from "zod";

// ── Timesheet approval ───────────────────────────────────────

export const timesheetApprovalSchema = z.object({
  action: z.enum(["approve", "needs_correction"]),
  admin_note: z.string().max(2000).optional(),
  correction_fields: z.array(
    z.enum(["actual_start", "actual_finish", "start_odometer", "finish_odometer"])
  ).optional(),
});

// ── Timesheet correction submission ──────────────────────────

export const correctionSubmitSchema = z.object({
  corrected_values: z.object({
    actual_start: z.string().datetime().optional(),
    actual_finish: z.string().datetime().optional(),
    start_odometer: z.number().min(0).optional(),
    finish_odometer: z.number().min(0).optional(),
    replacement_start_photo: z.string().optional().nullable(),
    replacement_finish_photo: z.string().optional().nullable(),
  }),
  employee_note: z.string().min(1, "An explanation note is required.").max(2000),
});

export type TimesheetApprovalInput = z.infer<typeof timesheetApprovalSchema>;
export type CorrectionSubmitInput = z.infer<typeof correctionSubmitSchema>;
