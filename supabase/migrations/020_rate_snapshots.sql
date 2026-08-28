-- ============================================================
-- Migration 020: Rate snapshots on shifts
--
-- Adds hourly_rate_snapshot and mileage_rate_snapshot to the
-- shifts table so rates are captured at publish/create time,
-- not at finish time.
--
-- Backfills existing shifts:
--   - Completed shifts WITH a timesheet → copy the timesheet's snapshots
--   - All other shifts → copy from the employee's current rates
-- ============================================================

-- ── 1. Add snapshot columns ─────────────────────────────────
ALTER TABLE public.shifts
  ADD COLUMN hourly_rate_snapshot   NUMERIC(10,2),
  ADD COLUMN mileage_rate_snapshot  NUMERIC(10,4);

-- ── 2. Backfill completed shifts from their timesheets ──────
-- These are the most accurate: the timesheet captured the rate
-- that was used when the shift was actually finished.
UPDATE public.shifts s
SET
  hourly_rate_snapshot  = t.hourly_rate_snapshot,
  mileage_rate_snapshot = t.mileage_rate_snapshot
FROM public.timesheets t
WHERE t.shift_id = s.id
  AND s.hourly_rate_snapshot IS NULL;

-- ── 3. Backfill remaining shifts from employee current rates ─
-- For shifts that don't have a timesheet yet (pending, accepted, etc.)
-- use the employee's current rate as the best available value.
UPDATE public.shifts s
SET
  hourly_rate_snapshot  = e.hourly_rate,
  mileage_rate_snapshot = COALESCE(e.mileage_rate, 0)
FROM public.employees e
WHERE e.id = s.employee_id
  AND s.hourly_rate_snapshot IS NULL;

-- ── 4. Default for new rows ─────────────────────────────────
-- New shifts will have these set by the application at create time.
-- No NOT NULL constraint yet — the app code change happens in Phase 4.
-- After Phase 4 is deployed and all new shifts populate this field,
-- a follow-up migration can add NOT NULL.


-- ============================================================
-- DONE — Shifts now carry rate snapshots.
--
-- Application change needed (Phase 4):
--   POST /api/shifts → set hourly_rate_snapshot, mileage_rate_snapshot
--   POST /api/shifts/[id]/finish → read from shift, not employee
--
-- Next migration: 021_timesheet_extensions.sql
-- ============================================================
