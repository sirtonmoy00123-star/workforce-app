/**
 * Standardized API error responses.
 *
 * Every mutation route should use these helpers to return
 * consistent, structured error responses that don't leak
 * internal database details.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";

// ── Error codes ──────────────────────────────────────────────

export const ErrorCode = {
  // Shift lifecycle
  SHIFT_NOT_FOUND: "SHIFT_NOT_FOUND",
  SHIFT_NOT_ACCEPTED: "SHIFT_NOT_ACCEPTED",
  SHIFT_RECONFIRMATION_REQUIRED: "SHIFT_RECONFIRMATION_REQUIRED",
  SHIFT_ALREADY_COMPLETED: "SHIFT_ALREADY_COMPLETED",
  SHIFT_CANCELLED: "SHIFT_CANCELLED",
  SHIFT_NOT_OWNED: "SHIFT_NOT_OWNED",

  // Attendance
  ATTENDANCE_REQUIRED: "ATTENDANCE_REQUIRED",
  ALREADY_CHECKED_IN: "ALREADY_CHECKED_IN",

  // Work session
  WORK_SESSION_ALREADY_STARTED: "WORK_SESSION_ALREADY_STARTED",
  WORK_SESSION_NOT_STARTED: "WORK_SESSION_NOT_STARTED",
  WORK_SESSION_ALREADY_FINISHED: "WORK_SESSION_ALREADY_FINISHED",
  WORK_SESSION_NOT_FOUND: "WORK_SESSION_NOT_FOUND",

  // Evidence
  TASK_PROOF_REQUIRED: "TASK_PROOF_REQUIRED",
  ODOMETER_REQUIRED: "ODOMETER_REQUIRED",
  INVALID_FILE: "INVALID_FILE",

  // Validation
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_TIME_RANGE: "INVALID_TIME_RANGE",

  // Security
  TENANT_ACCESS_DENIED: "TENANT_ACCESS_DENIED",
  FORBIDDEN: "FORBIDDEN",
  UNAUTHORIZED: "UNAUTHORIZED",

  // General
  NOT_FOUND: "NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

// ── Response helpers ─────────────────────────────────────────

/**
 * Return a structured API error. Never leaks DB details.
 */
export function apiError(
  code: ErrorCodeType,
  message: string,
  status: number = 400,
  extra?: Record<string, unknown>
) {
  return NextResponse.json(
    { error: message, code, ...extra },
    { status }
  );
}

/**
 * Format a ZodError into a structured API response.
 */
export function validationError(err: ZodError) {
  const issues = err.issues.map((i) => ({
    field: i.path.join("."),
    message: i.message,
  }));

  return NextResponse.json(
    {
      error: "Invalid input.",
      code: ErrorCode.INVALID_INPUT,
      issues,
    },
    { status: 400 }
  );
}

/**
 * Safely parse request JSON with a Zod schema.
 * Returns the parsed data or a NextResponse error.
 */
export async function parseBody<T>(
  request: Request,
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: ZodError } }
): Promise<T | NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(ErrorCode.INVALID_INPUT, "Invalid JSON body.", 400);
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    return validationError(result.error!);
  }
  return result.data as T;
}
