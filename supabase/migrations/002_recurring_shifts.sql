-- ============================================================
-- Migration 002: Add recurring shift support
-- Run this in Supabase SQL Editor.
-- ============================================================

-- Add a recurrence_type enum
CREATE TYPE public.recurrence_type AS ENUM ('NONE', 'NEXT_WEEK', 'WEEKLY_END_OF_MONTH', 'WEEKLY_CUSTOM_END');

-- Add recurring fields to the shifts table
ALTER TABLE public.shifts
  ADD COLUMN recurring_group_id UUID,
  ADD COLUMN is_recurring       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN recurrence_type    public.recurrence_type NOT NULL DEFAULT 'NONE',
  ADD COLUMN recurrence_end_date DATE;

-- Index for querying shifts by recurring group
CREATE INDEX idx_shifts_recurring_group ON public.shifts(recurring_group_id)
  WHERE recurring_group_id IS NOT NULL;

-- Done! The shifts table now supports recurring shift groups.
