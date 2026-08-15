-- Migration 003: Shift Editing Support
-- Adds: updated_pending shift status, shift_audit_log table, shift update tracking columns

-- 1. Add 'updated_pending' to shift_status enum
ALTER TYPE public.shift_status ADD VALUE IF NOT EXISTS 'updated_pending';

-- 2. Add update tracking columns to shifts table
ALTER TABLE public.shifts
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS last_change_reason TEXT;

-- 3. Create shift_audit_log table for recording all changes
CREATE TABLE IF NOT EXISTS public.shift_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id UUID NOT NULL REFERENCES public.shifts(id),
  employee_id UUID NOT NULL REFERENCES public.employees(id),
  changed_by UUID NOT NULL REFERENCES public.users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- What changed
  original_date DATE,
  new_date DATE,
  original_start TIMESTAMPTZ,
  new_start TIMESTAMPTZ,
  original_finish TIMESTAMPTZ,
  new_finish TIMESTAMPTZ,
  original_location TEXT,
  new_location TEXT,
  original_instructions TEXT,
  new_instructions TEXT,
  original_employee_id UUID REFERENCES public.employees(id),
  new_employee_id UUID REFERENCES public.employees(id),
  original_status TEXT,
  new_status TEXT,

  -- Reason and overrides
  change_reason TEXT NOT NULL,
  change_notes TEXT,
  override_reason TEXT,  -- if admin overrode a warning
  required_reconfirmation BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for audit log
CREATE INDEX IF NOT EXISTS idx_shift_audit_shift_id ON public.shift_audit_log(shift_id);
CREATE INDEX IF NOT EXISTS idx_shift_audit_employee_id ON public.shift_audit_log(employee_id);
CREATE INDEX IF NOT EXISTS idx_shift_audit_changed_at ON public.shift_audit_log(changed_at DESC);

-- RLS on audit log
ALTER TABLE public.shift_audit_log ENABLE ROW LEVEL SECURITY;

-- Admins can read/insert audit logs for their business (via shift → business_id)
CREATE POLICY "Admin can read shift audit logs"
  ON public.shift_audit_log FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.shifts s
      JOIN public.users u ON u.auth_user_id = auth.uid()
      WHERE s.id = shift_audit_log.shift_id
        AND s.business_id = u.business_id
        AND u.role = 'admin'
    )
  );

CREATE POLICY "Admin can insert shift audit logs"
  ON public.shift_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role = 'admin'
    )
  );
