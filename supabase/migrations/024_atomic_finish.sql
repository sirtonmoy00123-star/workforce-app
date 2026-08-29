-- ============================================================
-- Migration 024: Atomic complete_work_session() RPC
--
-- Wraps the finish-shift workflow in a single transaction:
--   1. Lock & validate work session + shift
--   2. Record finish timestamp
--   3. Calculate actual minutes
--   4. Update work session → completed
--   5. Create timesheet (or return existing — idempotent)
--   6. Update shift → completed
--   7. Insert audit event
--   8. COMMIT (or ROLLBACK on any failure)
--
-- Also adds missing UNIQUE constraints for idempotency:
--   - attendance_records(shift_id) — one attendance record per shift
--   - timesheets(shift_id) — one timesheet per shift (V1 rule)
-- ============================================================

-- ── 1. Unique constraints for idempotency ──────────────────

-- One attendance record per shift
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_records_shift
  ON public.attendance_records (shift_id);

-- One timesheet per shift (V1: one work session, one timesheet)
CREATE UNIQUE INDEX IF NOT EXISTS uq_timesheets_shift
  ON public.timesheets (shift_id);


-- ── 2. Atomic complete_work_session RPC ────────────────────

CREATE OR REPLACE FUNCTION public.complete_work_session(
  p_shift_id          UUID,
  p_employee_id       UUID,
  p_business_id       UUID,
  p_finish_at         TIMESTAMPTZ,
  -- Rate snapshots (from shift, set at publish time)
  p_hourly_rate       NUMERIC(10,2),
  p_mileage_rate      NUMERIC(10,2),
  -- Odometer
  p_start_odometer    NUMERIC(12,1) DEFAULT 0,
  p_finish_odometer   NUMERIC(12,1) DEFAULT 0,
  -- Scheduled times (for payable time — V1: payable = actual)
  p_scheduled_start   TIMESTAMPTZ DEFAULT NULL,
  p_scheduled_finish  TIMESTAMPTZ DEFAULT NULL,
  -- Breaks (V1 defaults)
  p_unpaid_break_min  INTEGER DEFAULT 0,
  p_paid_break_min    INTEGER DEFAULT 0,
  -- Audit
  p_user_id           UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session          RECORD;
  v_existing_ts      RECORD;
  v_actual_minutes   INTEGER;
  v_payable_start    TIMESTAMPTZ;
  v_payable_finish   TIMESTAMPTZ;
  v_payable_minutes  INTEGER;
  v_distance_km      NUMERIC(10,1);
  v_wage_amount      NUMERIC(10,2);
  v_mileage_amount   NUMERIC(10,2);
  v_total_amount     NUMERIC(10,2);
  v_timesheet_id     UUID;
  v_result           JSONB;
BEGIN
  -- ── STEP 1: Lock the work session row (FOR UPDATE prevents concurrent finishes)
  SELECT id, actual_start_at, status
    INTO v_session
    FROM public.work_sessions
   WHERE shift_id = p_shift_id
     AND employee_id = p_employee_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WORK_SESSION_NOT_FOUND: No work session exists for this shift.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── STEP 2: Idempotency — if already completed, return existing result
  IF v_session.status IN ('completed', 'approved') THEN
    SELECT id INTO v_existing_ts FROM public.timesheets WHERE shift_id = p_shift_id LIMIT 1;

    v_result := jsonb_build_object(
      'idempotent', true,
      'work_session_id', v_session.id,
      'timesheet_id', COALESCE(v_existing_ts.id, NULL)
    );
    RETURN v_result;
  END IF;

  -- ── STEP 3: Validate state
  IF v_session.status <> 'working' THEN
    RAISE EXCEPTION 'WORK_SESSION_NOT_ACTIVE: Work session status is %, expected working.'
      , v_session.status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_session.actual_start_at IS NULL THEN
    RAISE EXCEPTION 'WORK_SESSION_NO_START: Work session has no start timestamp.'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_finish_at <= v_session.actual_start_at THEN
    RAISE EXCEPTION 'INVALID_TIME_RANGE: Finish time must be after start time.'
      USING ERRCODE = 'P0001';
  END IF;

  -- ── STEP 4: Calculate actual minutes
  v_actual_minutes := ROUND(
    EXTRACT(EPOCH FROM (p_finish_at - v_session.actual_start_at)) / 60
  )::INTEGER;

  -- ── STEP 5: Calculate payable time (V1: payable = actual, capped to scheduled)
  -- If pay_before_scheduled_start is false (default), cap start to scheduled
  IF p_scheduled_start IS NOT NULL AND v_session.actual_start_at < p_scheduled_start THEN
    v_payable_start := p_scheduled_start;
  ELSE
    v_payable_start := v_session.actual_start_at;
  END IF;

  v_payable_finish := p_finish_at;

  v_payable_minutes := GREATEST(0,
    ROUND(EXTRACT(EPOCH FROM (v_payable_finish - v_payable_start)) / 60)::INTEGER
    - p_unpaid_break_min
  );

  -- ── STEP 6: Calculate mileage
  v_distance_km := GREATEST(0, p_finish_odometer - p_start_odometer);

  -- ── STEP 7: Calculate payment
  v_wage_amount := ROUND((v_payable_minutes / 60.0) * p_hourly_rate, 2);
  v_mileage_amount := ROUND(v_distance_km * p_mileage_rate, 2);
  v_total_amount := v_wage_amount + v_mileage_amount;

  -- ── STEP 8: Update work session → completed
  UPDATE public.work_sessions
  SET
    actual_finish_at       = p_finish_at,
    payable_start_at       = v_payable_start,
    payable_finish_at      = v_payable_finish,
    actual_worked_minutes  = v_actual_minutes,
    payable_worked_minutes = v_payable_minutes,
    paid_break_minutes     = p_paid_break_min,
    unpaid_break_minutes   = p_unpaid_break_min,
    finish_source          = 'EMPLOYEE_ACTION',
    status                 = 'completed',
    updated_at             = now()
  WHERE id = v_session.id;

  -- ── STEP 9: Create timesheet (idempotent via unique shift_id)
  INSERT INTO public.timesheets (
    shift_id, employee_id, business_id, work_session_id,
    scheduled_start, scheduled_finish,
    actual_start, actual_finish,
    worked_minutes, payable_worked_minutes,
    paid_break_minutes, unpaid_break_minutes,
    start_odometer, finish_odometer, distance_km,
    hourly_rate_snapshot, mileage_rate_snapshot,
    wage_amount, mileage_amount, total_amount,
    status, calculation_version
  ) VALUES (
    p_shift_id, p_employee_id, p_business_id, v_session.id,
    p_scheduled_start, p_scheduled_finish,
    v_session.actual_start_at, p_finish_at,
    v_actual_minutes, v_payable_minutes,
    p_paid_break_min, p_unpaid_break_min,
    p_start_odometer, p_finish_odometer, v_distance_km,
    p_hourly_rate, p_mileage_rate,
    v_wage_amount, v_mileage_amount, v_total_amount,
    'submitted', 1
  )
  ON CONFLICT (shift_id) DO NOTHING
  RETURNING id INTO v_timesheet_id;

  -- If ON CONFLICT fired, fetch existing
  IF v_timesheet_id IS NULL THEN
    SELECT id INTO v_timesheet_id FROM public.timesheets WHERE shift_id = p_shift_id;
  END IF;

  -- ── STEP 10: Update shift → completed
  UPDATE public.shifts
  SET status = 'completed', updated_at = now()
  WHERE id = p_shift_id;

  -- ── STEP 11: Audit event (best-effort within the transaction)
  INSERT INTO public.audit_events (
    business_id, user_id, event_type, entity_type, entity_id,
    changes
  ) VALUES (
    p_business_id, p_user_id, 'WORK_SESSION_FINISHED', 'work_session', v_session.id,
    jsonb_build_object(
      'shift_id', p_shift_id,
      'timesheet_id', v_timesheet_id,
      'actual_worked_minutes', v_actual_minutes,
      'payable_worked_minutes', v_payable_minutes,
      'total_amount', v_total_amount
    )
  );

  -- ── STEP 12: Return result
  v_result := jsonb_build_object(
    'idempotent', false,
    'work_session_id', v_session.id,
    'timesheet_id', v_timesheet_id,
    'actual_start_at', v_session.actual_start_at,
    'actual_finish_at', p_finish_at,
    'actual_worked_minutes', v_actual_minutes,
    'payable_worked_minutes', v_payable_minutes,
    'distance_km', v_distance_km,
    'wage_amount', v_wage_amount,
    'mileage_amount', v_mileage_amount,
    'total_amount', v_total_amount
  );

  RETURN v_result;
END;
$$;


-- ============================================================
-- DONE — Atomic finish workflow.
--
-- The RPC runs inside a single transaction:
-- - Row lock prevents concurrent finishes
-- - ON CONFLICT prevents duplicate timesheets
-- - Idempotency check returns existing result on retry
-- - Any RAISE EXCEPTION triggers ROLLBACK
--
-- Next: update workSessionService.ts to call this RPC
-- ============================================================
