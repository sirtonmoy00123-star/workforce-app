/**
 * Work Session Service — manages the work_sessions lifecycle.
 *
 * Centralizes start/finish work logic so it isn't duplicated
 * across API routes. The finish flow uses the atomic PostgreSQL
 * RPC `complete_work_session()` (migration 024) for transactional
 * safety — all steps succeed or all roll back.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { type PayableTimePolicy } from "@/lib/services/payableTime";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export interface StartWorkInput {
  shiftId: string;
  employeeId: string;
  businessId: string;
  serverTimestamp: string;  // ISO — always server time, never browser
}

export interface StartWorkResult {
  workSessionId: string;
  actualStartAt: string;
}

export interface FinishWorkInput {
  shiftId: string;
  employeeId: string;
  businessId: string;
  serverTimestamp: string;
  /** Rate snapshots from the shift (set at publish time) */
  hourlyRateSnapshot: number;
  mileageRateSnapshot: number;
  /** Odometer readings (0 if odometer not enabled) */
  startOdometerReading: number;
  finishOdometerReading: number;
  /** The shift's scheduled times (for payable time policy) */
  scheduledStartAt: string;
  scheduledEndAt: string;
  /** Payable time policy (defaults to EXACT_TIME) */
  policy?: PayableTimePolicy;
  /** Auth user ID for audit trail */
  userId?: string;
}

export interface FinishWorkResult {
  workSessionId: string;
  timesheetId: string;
  actualStartAt: string;
  actualFinishAt: string;
  actualWorkedMinutes: number;
  payableWorkedMinutes: number;
  distanceKm: number;
  wageAmount: number;
  mileageAmount: number;
  totalAmount: number;
}

// ────────────────────────────────────────────────────────────
// Start Work Session
// ────────────────────────────────────────────────────────────

/**
 * Create a new work session for a shift.
 * Idempotent: returns the existing session if one already exists.
 */
export async function startWorkSession(
  adminClient: SupabaseClient,
  input: StartWorkInput
): Promise<StartWorkResult> {
  // Check for existing session (idempotency)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (adminClient as any)
    .from("work_sessions")
    .select("id, actual_start_at")
    .eq("shift_id", input.shiftId)
    .eq("employee_id", input.employeeId)
    .maybeSingle();

  if (existing) {
    return {
      workSessionId: existing.id,
      actualStartAt: existing.actual_start_at,
    };
  }

  // Create new work session
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session, error } = await (adminClient as any)
    .from("work_sessions")
    .insert({
      shift_id: input.shiftId,
      employee_id: input.employeeId,
      business_id: input.businessId,
      actual_start_at: input.serverTimestamp,
      status: "working",
      start_source: "EMPLOYEE_ACTION",
    })
    .select("id, actual_start_at")
    .single();

  if (error) {
    // UNIQUE violation = concurrent request created it already
    if (error.code === "23505") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: retry } = await (adminClient as any)
        .from("work_sessions")
        .select("id, actual_start_at")
        .eq("shift_id", input.shiftId)
        .single();

      if (retry) {
        return { workSessionId: retry.id, actualStartAt: retry.actual_start_at };
      }
    }
    throw new Error(`Failed to create work session: ${error.message}`);
  }

  return {
    workSessionId: session.id,
    actualStartAt: session.actual_start_at,
  };
}

// ────────────────────────────────────────────────────────────
// Finish Work Session + Generate Timesheet (ATOMIC via RPC)
//
// Uses the PostgreSQL `complete_work_session()` RPC function
// (migration 024) which runs inside a single transaction with
// row locking, idempotency, and ROLLBACK on any failure.
// ────────────────────────────────────────────────────────────

/**
 * Complete a work session and generate the timesheet atomically.
 *
 * Calls the `complete_work_session` PostgreSQL RPC which performs
 * all steps in a single transaction:
 *   - Lock work session row (prevents concurrent finishes)
 *   - Validate state
 *   - Calculate payable time, mileage, payment
 *   - Update work session → completed
 *   - Create timesheet (idempotent via UNIQUE shift_id)
 *   - Update shift → completed
 *   - Insert audit event
 *
 * Idempotent: retrying after success returns the existing result.
 */
export async function finishWorkSession(
  adminClient: SupabaseClient,
  input: FinishWorkInput
): Promise<FinishWorkResult> {
  // Call the atomic RPC
  const { data, error } = await adminClient.rpc("complete_work_session", {
    p_shift_id: input.shiftId,
    p_employee_id: input.employeeId,
    p_business_id: input.businessId,
    p_finish_at: input.serverTimestamp,
    p_hourly_rate: input.hourlyRateSnapshot,
    p_mileage_rate: input.mileageRateSnapshot,
    p_start_odometer: input.startOdometerReading,
    p_finish_odometer: input.finishOdometerReading,
    p_scheduled_start: input.scheduledStartAt,
    p_scheduled_finish: input.scheduledEndAt,
    p_unpaid_break_min: input.policy?.defaultUnpaidBreakMinutes ?? 0,
    p_paid_break_min: input.policy?.defaultPaidBreakMinutes ?? 0,
    p_user_id: input.userId ?? null,
  });

  if (error) {
    // Map PostgreSQL error messages to structured errors
    const msg = error.message || "";
    if (msg.includes("WORK_SESSION_NOT_FOUND")) {
      throw Object.assign(new Error("No work session found for this shift."), { code: "WORK_SESSION_NOT_FOUND" });
    }
    if (msg.includes("WORK_SESSION_NOT_ACTIVE")) {
      throw Object.assign(new Error("This work session is not active."), { code: "WORK_SESSION_NOT_ACTIVE" });
    }
    if (msg.includes("INVALID_TIME_RANGE")) {
      throw Object.assign(new Error("Finish time must be after start time."), { code: "INVALID_TIME_RANGE" });
    }
    throw new Error(`Failed to complete work session: ${msg}`);
  }

  // data is JSONB from the RPC
  const result = data as Record<string, unknown>;

  // If idempotent (already completed), fetch the existing timesheet data
  if (result.idempotent) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ts } = await adminClient
      .from("timesheets")
      .select("*")
      .eq("shift_id", input.shiftId)
      .single();

    if (ts) {
      return {
        workSessionId: result.work_session_id as string,
        timesheetId: ts.id,
        actualStartAt: ts.actual_start,
        actualFinishAt: ts.actual_finish,
        actualWorkedMinutes: ts.worked_minutes,
        payableWorkedMinutes: ts.payable_worked_minutes ?? ts.worked_minutes,
        distanceKm: ts.distance_km,
        wageAmount: ts.wage_amount,
        mileageAmount: ts.mileage_amount,
        totalAmount: ts.total_amount,
      };
    }
  }

  return {
    workSessionId: result.work_session_id as string,
    timesheetId: result.timesheet_id as string,
    actualStartAt: result.actual_start_at as string,
    actualFinishAt: result.actual_finish_at as string,
    actualWorkedMinutes: Number(result.actual_worked_minutes),
    payableWorkedMinutes: Number(result.payable_worked_minutes),
    distanceKm: Number(result.distance_km),
    wageAmount: Number(result.wage_amount),
    mileageAmount: Number(result.mileage_amount),
    totalAmount: Number(result.total_amount),
  };
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Get the active work session for a shift, if one exists.
 */
export async function getWorkSession(
  adminClient: SupabaseClient,
  shiftId: string
): Promise<{
  id: string;
  status: string;
  actual_start_at: string | null;
  actual_finish_at: string | null;
} | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient as any)
    .from("work_sessions")
    .select("id, status, actual_start_at, actual_finish_at")
    .eq("shift_id", shiftId)
    .maybeSingle();

  return data || null;
}
