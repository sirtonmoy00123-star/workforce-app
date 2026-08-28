-- ============================================================
-- Migration 023: Backfill work_sessions + enforce constraints
--
-- Now that Phase 4 code writes all new columns, this migration:
--   1. Backfills actual_worked_minutes for completed sessions
--   2. Sets payable_start/finish = actual_start/finish (V1 policy = EXACT_TIME)
--   3. Sets payable_worked_minutes = actual_worked_minutes (V1, no rounding)
--   4. Sets start_source / finish_source for existing records
--   5. Adds NOT NULL on shifts.hourly_rate_snapshot
--   6. Verification queries (SELECT-only, no data changes)
-- ============================================================

-- ── 1. Backfill actual_worked_minutes ──────────────────────
-- For completed sessions that have both start and finish timestamps.
UPDATE public.work_sessions
SET actual_worked_minutes = ROUND(
  EXTRACT(EPOCH FROM (actual_finish_at - actual_start_at)) / 60
)::INTEGER
WHERE actual_finish_at IS NOT NULL
  AND actual_start_at IS NOT NULL
  AND actual_worked_minutes IS NULL;

-- ── 2. Set payable times = actual times (V1: EXACT_TIME policy) ─
UPDATE public.work_sessions
SET
  payable_start_at = actual_start_at,
  payable_finish_at = actual_finish_at,
  payable_worked_minutes = actual_worked_minutes
WHERE actual_finish_at IS NOT NULL
  AND payable_start_at IS NULL;

-- ── 3. Set start/finish source for existing records ────────
-- All existing records were created by employee action (pre-refactor)
UPDATE public.work_sessions
SET start_source = 'EMPLOYEE_ACTION'
WHERE start_source IS NULL
  AND actual_start_at IS NOT NULL;

UPDATE public.work_sessions
SET finish_source = 'EMPLOYEE_ACTION'
WHERE finish_source IS NULL
  AND actual_finish_at IS NOT NULL;

-- ── 4. Set timesheets.calculation_version = 1 for pre-refactor records ─
-- Migration 021 already set DEFAULT 1 on new inserts.
-- This catches any NULL values if the column existed before the default was added.
UPDATE public.timesheets
SET calculation_version = 1
WHERE calculation_version IS NULL;

-- ── 5. Enforce NOT NULL on shift rate snapshots ────────────
-- Phase 4 code always sets these on creation. Backfill already ran in 020.
-- Any remaining NULLs get the employee's current rate as a safe default.
UPDATE public.shifts s
SET
  hourly_rate_snapshot  = COALESCE(s.hourly_rate_snapshot, e.hourly_rate),
  mileage_rate_snapshot = COALESCE(s.mileage_rate_snapshot, e.mileage_rate, 0)
FROM public.employees e
WHERE e.id = s.employee_id
  AND (s.hourly_rate_snapshot IS NULL OR s.mileage_rate_snapshot IS NULL);

-- Now safe to enforce NOT NULL
ALTER TABLE public.shifts
  ALTER COLUMN hourly_rate_snapshot SET NOT NULL,
  ALTER COLUMN mileage_rate_snapshot SET NOT NULL;

-- Set defaults so any edge-case INSERT without explicit values
-- doesn't fail (the app always provides them, but defense in depth)
ALTER TABLE public.shifts
  ALTER COLUMN hourly_rate_snapshot SET DEFAULT 0,
  ALTER COLUMN mileage_rate_snapshot SET DEFAULT 0;


-- ============================================================
-- DONE — All existing data is backfilled, constraints enforced.
--
-- Verification queries to run manually after migration:
--
-- 1. Work sessions with missing computed columns:
--    SELECT count(*) FROM work_sessions
--    WHERE actual_finish_at IS NOT NULL AND actual_worked_minutes IS NULL;
--    → Expected: 0
--
-- 2. Timesheets without work_session_id (should be 0 if 021 ran):
--    SELECT count(*) FROM timesheets WHERE work_session_id IS NULL;
--    → Expected: 0 (or low count for edge cases)
--
-- 3. Shifts without rate snapshots:
--    SELECT count(*) FROM shifts
--    WHERE hourly_rate_snapshot IS NULL OR mileage_rate_snapshot IS NULL;
--    → Expected: 0 (enforced by NOT NULL now)
--
-- 4. Work session ↔ timesheet alignment:
--    SELECT count(*) FROM work_sessions ws
--    LEFT JOIN timesheets t ON t.work_session_id = ws.id
--    WHERE ws.status = 'completed' AND t.id IS NULL;
--    → Expected: 0 (every completed session should have a timesheet)
-- ============================================================
