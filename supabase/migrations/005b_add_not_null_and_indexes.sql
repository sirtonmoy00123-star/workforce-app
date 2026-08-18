-- ============================================================
-- Migration 005b: Add NOT NULL + indexes on business_id columns
-- Phase 1 — Run ONLY after 005 counts are verified.
--
-- This is separate from 005 per the conversion rules:
-- "Do not add NOT NULL in the same migration as the column."
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- NOT NULL constraints on the 6 newly-added business_id columns
-- (users, employees, shifts, timesheet_corrections already had
--  business_id as NOT NULL from migration 001/004)
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.employee_availability
  ALTER COLUMN business_id SET NOT NULL;

ALTER TABLE public.shift_attendance
  ALTER COLUMN business_id SET NOT NULL;

ALTER TABLE public.odometer_submissions
  ALTER COLUMN business_id SET NOT NULL;

ALTER TABLE public.timesheets
  ALTER COLUMN business_id SET NOT NULL;

ALTER TABLE public.payments
  ALTER COLUMN business_id SET NOT NULL;

ALTER TABLE public.shift_audit_log
  ALTER COLUMN business_id SET NOT NULL;


-- ────────────────────────────────────────────────────────────
-- Indexes on all new business_id columns
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_availability_business
  ON public.employee_availability(business_id);

CREATE INDEX IF NOT EXISTS idx_attendance_business
  ON public.shift_attendance(business_id);

CREATE INDEX IF NOT EXISTS idx_odometer_business
  ON public.odometer_submissions(business_id);

CREATE INDEX IF NOT EXISTS idx_timesheets_business
  ON public.timesheets(business_id);

CREATE INDEX IF NOT EXISTS idx_payments_business
  ON public.payments(business_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_business
  ON public.shift_audit_log(business_id);

CREATE INDEX IF NOT EXISTS idx_corrections_business
  ON public.timesheet_corrections(business_id);


-- ────────────────────────────────────────────────────────────
-- DONE — business_id is now NOT NULL + indexed on all tables.
-- ────────────────────────────────────────────────────────────
