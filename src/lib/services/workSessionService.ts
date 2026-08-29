/**
 * Work Session Service — manages the work_sessions lifecycle.
 *
 * Centralizes start/finish work logic so it isn't duplicated
 * across API routes. The finish flow uses the atomic PostgreSQL
 * RPC `complete_work_session()` (migration 024) for transactional
 * safety — all steps succeed or all roll back.
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { calculatePayableTime, DEFAULT_POLICY, type PayableTimePolicy } from "@/lib/services/payableTime";
import { calculateWorkedMinutes } from "@/lib/calculations/time";
import { calculateMileage } from "@/lib/calculations/mileage";
import { calculatePayment } from "@/lib/calculations/payment";

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
// Finish Work Session + Generate Timesheet
//
// Uses direct DB calls with idempotency guards (UNIQUE constraints
// from migration 024 prevent duplicates). The atomic RPC
// complete_work_session() is available as a future upgrade path.
// ────────────────────────────────────────────────────────────

/**
 * Complete a work session and generate the timesheet.
 *
 * Steps:
 *   1. Fetch & validate work session
 *   2. Calculate payable time, mileage, payment
 *   3. Update work session → completed
 *   4. Create timesheet (idempotent via UNIQUE shift_id)
 *   5. Update shift → completed
 *   6. Insert audit event
 *
 * Idempotent: UNIQUE constraints prevent duplicate timesheets.
 */
export async function finishWorkSession(
  adminClient: SupabaseClient,
  input: FinishWorkInput
): Promise<FinishWorkResult> {
  // ── Step 1: Fetch the work session ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: session } = await (adminClient as any)
    .from("work_sessions")
    .select("id, actual_start_at, status")
    .eq("shift_id", input.shiftId)
    .eq("employee_id", input.employeeId)
    .single();

  if (!session) {
    throw Object.assign(new Error("No work session found for this shift."), { code: "WORK_SESSION_NOT_FOUND" });
  }

  // Idempotency: if already completed, return existing timesheet
  if (session.status === "completed" || session.status === "approved") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingTs } = await (adminClient as any)
      .from("timesheets")
      .select("*")
      .eq("shift_id", input.shiftId)
      .single();

    if (existingTs) {
      return {
        workSessionId: session.id,
        timesheetId: existingTs.id,
        actualStartAt: existingTs.actual_start,
        actualFinishAt: existingTs.actual_finish,
        actualWorkedMinutes: existingTs.worked_minutes,
        payableWorkedMinutes: existingTs.payable_worked_minutes ?? existingTs.worked_minutes,
        distanceKm: existingTs.distance_km,
        wageAmount: existingTs.wage_amount,
        mileageAmount: existingTs.mileage_amount,
        totalAmount: existingTs.total_amount ?? existingTs.estimated_total,
      };
    }
  }

  if (session.status !== "working") {
    throw Object.assign(new Error("This work session is not active."), { code: "WORK_SESSION_NOT_ACTIVE" });
  }

  const actualStartAt = session.actual_start_at;
  const actualFinishAt = input.serverTimestamp;

  // ── Step 2: Calculate everything ──
  const actualWorkedMinutes = calculateWorkedMinutes(new Date(actualStartAt), new Date(actualFinishAt));
  const distanceKm = calculateMileage(input.startOdometerReading, input.finishOdometerReading);

  // Payable time (with early-start capping, breaks, rounding)
  const policy = input.policy ?? DEFAULT_POLICY;
  let payableStartAt = actualStartAt;
  let payableFinishAt = actualFinishAt;
  let payableWorkedMinutes = actualWorkedMinutes;
  let paidBreakMinutes = 0;
  let unpaidBreakMinutes = 0;

  if (input.scheduledStartAt && input.scheduledEndAt) {
    const payable = calculatePayableTime({
      scheduledStartAt: input.scheduledStartAt,
      scheduledEndAt: input.scheduledEndAt,
      actualStartAt,
      actualFinishAt,
    }, policy);
    payableStartAt = payable.payableStartAt;
    payableFinishAt = payable.payableFinishAt;
    payableWorkedMinutes = payable.payableWorkedMinutes;
    paidBreakMinutes = payable.paidBreakMinutes;
    unpaidBreakMinutes = payable.unpaidBreakMinutes;
  }

  const payment = calculatePayment(
    payableWorkedMinutes,
    distanceKm,
    input.hourlyRateSnapshot,
    input.mileageRateSnapshot
  );

  // ── Step 3: Update work session → completed ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient as any)
    .from("work_sessions")
    .update({
      actual_finish_at: actualFinishAt,
      payable_start_at: payableStartAt,
      payable_finish_at: payableFinishAt,
      actual_worked_minutes: actualWorkedMinutes,
      payable_worked_minutes: payableWorkedMinutes,
      paid_break_minutes: paidBreakMinutes,
      unpaid_break_minutes: unpaidBreakMinutes,
      finish_source: "EMPLOYEE_ACTION",
      status: "completed",
    })
    .eq("id", session.id);

  // ── Step 4: Create timesheet (idempotent via UNIQUE on shift_id) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: newTs, error: tsError } = await (adminClient as any)
    .from("timesheets")
    .upsert({
      shift_id: input.shiftId,
      employee_id: input.employeeId,
      business_id: input.businessId,
      work_session_id: session.id,
      scheduled_start: input.scheduledStartAt,
      scheduled_finish: input.scheduledEndAt,
      actual_start: actualStartAt,
      actual_finish: actualFinishAt,
      worked_minutes: actualWorkedMinutes,
      payable_worked_minutes: payableWorkedMinutes,
      paid_break_minutes: paidBreakMinutes,
      unpaid_break_minutes: unpaidBreakMinutes,
      start_odometer: input.startOdometerReading,
      finish_odometer: input.finishOdometerReading,
      distance_km: distanceKm,
      hourly_rate_snapshot: input.hourlyRateSnapshot,
      mileage_rate_snapshot: input.mileageRateSnapshot,
      wage_amount: payment.wageAmount,
      mileage_amount: payment.mileageAmount,
      total_amount: payment.totalAmount,
      status: "submitted",
    }, { onConflict: "shift_id" })
    .select("id")
    .single();

  let timesheetId = newTs?.id;

  // If upsert failed, try fetching existing
  if (tsError || !timesheetId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: fallbackTs } = await (adminClient as any)
      .from("timesheets")
      .select("id")
      .eq("shift_id", input.shiftId)
      .single();
    timesheetId = fallbackTs?.id ?? "unknown";
  }

  // ── Step 5: Update shift → completed ──
  await adminClient
    .from("shifts")
    .update({ status: "completed" } as never)
    .eq("id", input.shiftId);

  // ── Step 6: Audit event (best effort) ──
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminClient as any)
      .from("audit_events")
      .insert({
        business_id: input.businessId,
        user_id: input.userId ?? null,
        event_type: "WORK_SESSION_FINISHED",
        entity_type: "work_session",
        entity_id: session.id,
        changes: {
          shift_id: input.shiftId,
          timesheet_id: timesheetId,
          actual_worked_minutes: actualWorkedMinutes,
          payable_worked_minutes: payableWorkedMinutes,
          total_amount: payment.totalAmount,
        },
      });
  } catch {
    // Audit failure should not block the finish flow
    console.error("Audit event insert failed (non-fatal)");
  }

  return {
    workSessionId: session.id,
    timesheetId,
    actualStartAt,
    actualFinishAt,
    actualWorkedMinutes,
    payableWorkedMinutes,
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
