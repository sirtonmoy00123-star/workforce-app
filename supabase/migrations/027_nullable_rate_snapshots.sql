-- ============================================================
-- Migration 027: Make rate snapshots nullable for unfilled shifts
-- ============================================================
-- Phase 6 introduced unfilled shifts (employee_id = NULL).
-- These shifts have no employee to snapshot rates from.

ALTER TABLE shifts
  ALTER COLUMN hourly_rate_snapshot DROP NOT NULL,
  ALTER COLUMN mileage_rate_snapshot DROP NOT NULL;

-- Keep default 0 for backward compat (existing code that omits the column)
-- but allow explicit NULL for unfilled shifts.
