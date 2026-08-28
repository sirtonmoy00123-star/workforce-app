-- ============================================================
-- Migration 019: shift_attendance → work_sessions
--
-- Renames the existing shift_attendance table to work_sessions
-- (preserving all data, indexes, constraints, RLS policies)
-- and adds the new columns required by the work-session domain.
--
-- A compatibility VIEW "shift_attendance" is created so any
-- code not yet updated continues to work during the transition.
--
-- Existing enum `attendance_status` is reused (pending/working/completed)
-- and extended with REVIEW_REQUIRED and APPROVED values.
-- ============================================================

-- ── 1. Extend the enum with new statuses ────────────────────
ALTER TYPE public.attendance_status ADD VALUE IF NOT EXISTS 'review_required';
ALTER TYPE public.attendance_status ADD VALUE IF NOT EXISTS 'approved';

-- ── 2. Rename table ─────────────────────────────────────────
ALTER TABLE public.shift_attendance RENAME TO work_sessions;

-- ── 3. Rename the column to match domain language ───────────
-- attendance_status → status  (the table is no longer about attendance)
ALTER TABLE public.work_sessions RENAME COLUMN attendance_status TO status;

-- ── 4. Add new columns ──────────────────────────────────────
ALTER TABLE public.work_sessions

  -- Payable time (may differ from actual after rounding/policy)
  ADD COLUMN payable_start_at    TIMESTAMPTZ,
  ADD COLUMN payable_finish_at   TIMESTAMPTZ,

  -- Calculated minutes
  ADD COLUMN actual_worked_minutes   INTEGER,
  ADD COLUMN payable_worked_minutes  INTEGER,

  -- Breaks
  ADD COLUMN paid_break_minutes    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN unpaid_break_minutes  INTEGER NOT NULL DEFAULT 0,

  -- How the session was started/finished
  ADD COLUMN start_source   TEXT CHECK (start_source IN (
    'EMPLOYEE_ACTION', 'ATTENDANCE', 'ADMIN_OVERRIDE', 'AUTO'
  )),
  ADD COLUMN finish_source  TEXT CHECK (finish_source IN (
    'EMPLOYEE_ACTION', 'ATTENDANCE', 'ADMIN_OVERRIDE', 'AUTO'
  )),

  -- Review flag
  ADD COLUMN requires_review BOOLEAN NOT NULL DEFAULT false;

-- ── 5. Rename actual_start / actual_finish for clarity ──────
-- Keep the old names available via the compatibility view.
ALTER TABLE public.work_sessions RENAME COLUMN actual_start  TO actual_start_at;
ALTER TABLE public.work_sessions RENAME COLUMN actual_finish TO actual_finish_at;

-- ── 6. Additional indexes ───────────────────────────────────
-- shift_id already has a UNIQUE index from the original schema.
-- business_id already has an index from migration 005b.
CREATE INDEX IF NOT EXISTS idx_work_sessions_employee
  ON public.work_sessions(employee_id);

CREATE INDEX IF NOT EXISTS idx_work_sessions_status
  ON public.work_sessions(status);

CREATE INDEX IF NOT EXISTS idx_work_sessions_actual_start
  ON public.work_sessions(actual_start_at);

-- ── 7. Rename the existing trigger ──────────────────────────
-- The trigger name references the old table; rename for clarity.
-- (DROP + recreate because ALTER TRIGGER … RENAME is not supported
--  on all Postgres versions.)
DROP TRIGGER IF EXISTS trg_shift_attendance_updated_at ON public.work_sessions;

CREATE TRIGGER trg_work_sessions_updated_at
  BEFORE UPDATE ON public.work_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── 8. Rename existing indexes for clarity ──────────────────
ALTER INDEX IF EXISTS idx_shift_attendance_shift_id
  RENAME TO idx_work_sessions_shift_id;

ALTER INDEX IF EXISTS idx_attendance_business
  RENAME TO idx_work_sessions_business;

-- ── 9. Compatibility VIEW ───────────────────────────────────
-- Maps old column names so un-migrated code still works.
-- The view is read-only by default; writes go to the real table.
-- Remove this view in the cleanup phase (Phase 8) once all code
-- references work_sessions directly.
CREATE OR REPLACE VIEW public.shift_attendance AS
SELECT
  id,
  shift_id,
  employee_id,
  business_id,
  actual_start_at  AS actual_start,
  actual_finish_at AS actual_finish,
  status           AS attendance_status,
  created_at,
  updated_at
FROM public.work_sessions;

-- ── 10. RLS policies ────────────────────────────────────────
-- The original RLS policies survive the rename automatically.
-- But their names reference "Attendance:" — rename for clarity.
-- We drop and recreate with the same USING/WITH CHECK clauses.

-- Drop old policies (they still exist, attached to the renamed table)
DROP POLICY IF EXISTS "Attendance: admin sees same-business"   ON public.work_sessions;
DROP POLICY IF EXISTS "Attendance: employee sees own"          ON public.work_sessions;
DROP POLICY IF EXISTS "Attendance: employee can insert own"    ON public.work_sessions;
DROP POLICY IF EXISTS "Attendance: employee can update own"    ON public.work_sessions;

-- Recreate with work_sessions naming
CREATE POLICY "Work sessions: admin sees same-business"
  ON public.work_sessions FOR SELECT
  USING (
    business_id = public.current_user_business_id()
  );

CREATE POLICY "Work sessions: employee sees own"
  ON public.work_sessions FOR SELECT
  USING (employee_id = public.current_employee_id());

CREATE POLICY "Work sessions: employee can insert own"
  ON public.work_sessions FOR INSERT
  WITH CHECK (employee_id = public.current_employee_id());

CREATE POLICY "Work sessions: employee can update own"
  ON public.work_sessions FOR UPDATE
  USING (employee_id = public.current_employee_id());


-- ============================================================
-- DONE — shift_attendance is now work_sessions.
--
-- Old code can still query via the "shift_attendance" view
-- until it is migrated in Phase 4.
--
-- Next migration: 020_rate_snapshots.sql
-- ============================================================
