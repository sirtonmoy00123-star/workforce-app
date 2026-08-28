/**
 * Work Session Service — manages the work_sessions lifecycle.
 *
 * Centralizes start/finish work logic so it isn't duplicated
 * across API routes. The finish flow is designed to be wrapped
 * in a single database transaction (Phase 4 will add the RPC).
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { calculateWorkedMinutes } from "@/lib/calculations/time";
import { calculateMileage } from "@/lib/calculations/mileage";
import { calculatePayment } from "@/lib/calculations/payment";
import {
  calculatePayableTime,
  DEFAULT_POLICY,
  type PayableTimePolicy,
} from "@/lib/services/payableTime";

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
// Finish Work Session + Generate Timesheet
//
// NOTE: In Phase 4 this will be wrapped in a PostgreSQL RPC
// for true transactional safety. For now it executes sequentially.
// ────────────────────────────────────────────────────────────

/**
 * Complete a work session and generate the timesheet.
 *
 * Steps (all must succeed):
 * 1. Get the active work session
 * 2. Calculate payable time
 * 3. Calculate mileage
 * 4. Calculate payment
 * 5. Update work session → FINISHED
 * 6. Create timesheet → submitted
 * 7. Update shift → completed
 *
 * Returns the complete result for the API response.
 */
export async function finishWorkSession(
  adminClient: SupabaseClient,
  input: FinishWorkInput
): Promise<FinishWorkResult> {
  // 1. Get active work session
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session, error: sessionErr } = await (adminClient as any)
    .from("work_sessions")
    .select("id, actual_start_at, status")
    .eq("shift_id", input.shiftId)
    .eq("employee_id", input.employeeId)
    .single();

  if (sessionErr || !session) {
    throw new Error("No work session found for this shift.");
  }
  if (session.status !== "working") {
    throw new Error("This work session is not active.");
  }

  // 2. Calculate payable time
  const policy = input.policy || DEFAULT_POLICY;
  const payableResult = calculatePayableTime(
    {
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      actualStartAt: session.actual_start_at,
      actualFinishAt: input.serverTimestamp,
    },
    policy
  );

  // 3. Calculate mileage
  const distanceKm = calculateMileage(
    input.startOdometerReading,
    input.finishOdometerReading
  );

  // 4. Calculate payment using payable minutes (not actual)
  const payment = calculatePayment(
    payableResult.payableWorkedMinutes,
    distanceKm,
    input.hourlyRateSnapshot,
    input.mileageRateSnapshot
  );

  // 5. Update work session
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (adminClient as any)
    .from("work_sessions")
    .update({
      actual_finish_at: input.serverTimestamp,
      payable_start_at: payableResult.payableStartAt,
      payable_finish_at: payableResult.payableFinishAt,
      actual_worked_minutes: payableResult.actualWorkedMinutes,
      payable_worked_minutes: payableResult.payableWorkedMinutes,
      unpaid_break_minutes: payableResult.unpaidBreakMinutes,
      paid_break_minutes: payableResult.paidBreakMinutes,
      finish_source: "EMPLOYEE_ACTION",
      status: "completed",
    })
    .eq("id", session.id);

  if (updateErr) {
    throw new Error(`Failed to update work session: ${updateErr.message}`);
  }

  // 6. Create timesheet
  const { data: timesheet, error: tsErr } = await adminClient
    .from("timesheets")
    .insert({
      shift_id: input.shiftId,
      employee_id: input.employeeId,
      business_id: input.businessId,
      work_session_id: session.id,
      scheduled_start: input.scheduledStartAt,
      scheduled_finish: input.scheduledEndAt,
      actual_start: session.actual_start_at,
      actual_finish: input.serverTimestamp,
      worked_minutes: payableResult.actualWorkedMinutes,
      payable_worked_minutes: payableResult.payableWorkedMinutes,
      paid_break_minutes: payableResult.paidBreakMinutes,
      unpaid_break_minutes: payableResult.unpaidBreakMinutes,
      start_odometer: input.startOdometerReading,
      finish_odometer: input.finishOdometerReading,
      distance_km: distanceKm,
      hourly_rate_snapshot: input.hourlyRateSnapshot,
      mileage_rate_snapshot: input.mileageRateSnapshot,
      wage_amount: payment.wageAmount,
      mileage_amount: payment.mileageAmount,
      total_amount: payment.totalAmount,
      status: "submitted",
    })
    .select("id")
    .single();

  if (tsErr) {
    throw new Error(`Failed to create timesheet: ${tsErr.message}`);
  }

  // 7. Update shift status
  const { error: shiftErr } = await adminClient
    .from("shifts")
    .update({ status: "completed" })
    .eq("id", input.shiftId);

  if (shiftErr) {
    throw new Error(`Failed to update shift status: ${shiftErr.message}`);
  }

  return {
    workSessionId: session.id,
    timesheetId: timesheet.id,
    actualStartAt: session.actual_start_at,
    actualFinishAt: input.serverTimestamp,
    actualWorkedMinutes: payableResult.actualWorkedMinutes,
    payableWorkedMinutes: payableResult.payableWorkedMinutes,
    distanceKm,
    wageAmount: payment.wageAmount,
    mileageAmount: payment.mileageAmount,
    totalAmount: payment.totalAmount,
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
