-- ============================================================
-- Migration 021: Timesheet extensions
--
-- Links timesheets to work_sessions and adds payable-time,
-- break, and adjustment fields for the refactored architecture.
-- ============================================================

-- ── 1. Add work_session_id FK ───────────────────────────────
ALTER TABLE public.timesheets
  ADD COLUMN work_session_id UUID REFERENCES public.work_sessions(id) ON DELETE SET NULL;

-- ── 2. Backfill work_session_id from shift_id join ──────────
-- Each timesheet has a shift_id; each work_session has a shift_id (UNIQUE).
-- Join through shift_id to link them.
UPDATE public.timesheets t
SET work_session_id = ws.id
FROM public.work_sessions ws
WHERE ws.shift_id = t.shift_id
  AND t.work_session_id IS NULL;

-- ── 3. Index on work_session_id ─────────────────────────────
CREATE INDEX IF NOT EXISTS idx_timesheets_work_session
  ON public.timesheets(work_session_id);

-- ── 4. Add payable and break columns ────────────────────────
ALTER TABLE public.timesheets
  ADD COLUMN payable_worked_minutes  INTEGER,
  ADD COLUMN paid_break_minutes      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN unpaid_break_minutes    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN adjustment_amount       NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN calculation_version     SMALLINT NOT NULL DEFAULT 1;

-- ── 5. Backfill payable_worked_minutes from worked_minutes ──
-- In the current system, actual = payable. Set them equal.
UPDATE public.timesheets
SET payable_worked_minutes = worked_minutes
WHERE payable_worked_minutes IS NULL;

-- ── 6. Rename estimated_total → total_amount ────────────────
-- The value is no longer an estimate once it's calculated from
-- a completed work session. Keep estimated_total as a generated
-- alias via the view if needed, but the canonical column is total_amount.
ALTER TABLE public.timesheets
  RENAME COLUMN estimated_total TO total_amount;

-- ── 7. Additional index on status (frequently filtered) ─────
CREATE INDEX IF NOT EXISTS idx_timesheets_status
  ON public.timesheets(status);


-- ============================================================
-- DONE — Timesheets now link to work_sessions and carry
-- payable/break/adjustment fields.
--
-- Note: estimated_total → total_amount rename means the
-- application code must be updated in Phase 4 to use total_amount.
-- Until then, the old column name will cause errors.
-- Update the code references before running this migration
-- in production, OR run this migration and deploy the code
-- change simultaneously.
--
-- Next migration: 022_audit_events.sql
-- ============================================================
