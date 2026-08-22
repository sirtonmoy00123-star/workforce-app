-- ============================================================
-- Migration 011 — Per-shift odometer requirement toggle
--
-- Adds a require_odometer column to shifts so admins can turn
-- odometer on/off per shift, independently of the employee-level
-- odometer_tracking_enabled setting.
--
-- NULL  = use employee default (employees.odometer_tracking_enabled)
-- true  = require odometer for this shift regardless of employee setting
-- false = skip odometer for this shift regardless of employee setting
-- ============================================================

ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS require_odometer BOOLEAN;

COMMENT ON COLUMN public.shifts.require_odometer IS
  'Per-shift odometer override. NULL = use employee default, true/false = override.';

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
