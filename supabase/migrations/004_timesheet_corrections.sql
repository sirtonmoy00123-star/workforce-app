-- Migration 004: Timesheet Correction Workflow
-- Adds: correction_required/correction_submitted statuses, timesheet_corrections table

-- 1. Add new timesheet statuses
ALTER TYPE public.timesheet_status ADD VALUE IF NOT EXISTS 'correction_required';
ALTER TYPE public.timesheet_status ADD VALUE IF NOT EXISTS 'correction_submitted';

-- 2. Create timesheet_corrections table
CREATE TABLE IF NOT EXISTS public.timesheet_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  timesheet_id UUID NOT NULL REFERENCES public.timesheets(id),
  employee_id UUID NOT NULL REFERENCES public.employees(id),

  correction_round INTEGER NOT NULL DEFAULT 1,

  -- What Admin requested
  requested_fields TEXT[] NOT NULL,  -- e.g. {'actual_finish','finish_odometer','finish_photo'}
  admin_note TEXT NOT NULL,

  -- Original values at time of request (JSON snapshot)
  original_values JSONB NOT NULL,

  -- Employee corrected values (JSON, filled when employee submits)
  corrected_values JSONB,

  -- Recalculated values after correction (JSON, filled when employee submits)
  recalculated_values JSONB,

  -- Employee note
  employee_note TEXT,

  -- Replacement photos
  replacement_start_photo TEXT,
  replacement_finish_photo TEXT,

  -- Who and when
  requested_by UUID NOT NULL REFERENCES public.users(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,

  -- Status of this correction round
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'approved', 'rejected')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_correction_timesheet_id ON public.timesheet_corrections(timesheet_id);
CREATE INDEX IF NOT EXISTS idx_correction_employee_id ON public.timesheet_corrections(employee_id);
CREATE INDEX IF NOT EXISTS idx_correction_status ON public.timesheet_corrections(status);

-- RLS
ALTER TABLE public.timesheet_corrections ENABLE ROW LEVEL SECURITY;

-- Admin can read corrections for their business
CREATE POLICY "Admin can read timesheet corrections"
  ON public.timesheet_corrections FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.business_id = timesheet_corrections.business_id
        AND u.role = 'admin'
    )
  );

-- Admin can insert corrections
CREATE POLICY "Admin can insert timesheet corrections"
  ON public.timesheet_corrections FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role = 'admin'
    )
  );

-- Admin can update corrections (for approval)
CREATE POLICY "Admin can update timesheet corrections"
  ON public.timesheet_corrections FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.business_id = timesheet_corrections.business_id
        AND u.role = 'admin'
    )
  );

-- Employee can read their own corrections
CREATE POLICY "Employee can read own corrections"
  ON public.timesheet_corrections FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      JOIN public.users u ON u.id = e.user_id
      WHERE u.auth_user_id = auth.uid()
        AND e.id = timesheet_corrections.employee_id
    )
  );

-- Employee can update their own pending corrections (to submit)
CREATE POLICY "Employee can update own pending corrections"
  ON public.timesheet_corrections FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.employees e
      JOIN public.users u ON u.id = e.user_id
      WHERE u.auth_user_id = auth.uid()
        AND e.id = timesheet_corrections.employee_id
    )
    AND status = 'pending'
  );
