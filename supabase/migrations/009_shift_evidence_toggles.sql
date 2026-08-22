-- 009_shift_evidence_toggles.sql
-- Per-employee toggles for Odometer Tracking and Task Proof Photos

-- Default odometer to TRUE (preserves existing behavior — all employees currently require odometer)
ALTER TABLE public.employees
  ADD COLUMN odometer_tracking_enabled BOOLEAN NOT NULL DEFAULT true;

-- Default task proof to FALSE (opt-in per employee)
ALTER TABLE public.employees
  ADD COLUMN task_proof_enabled BOOLEAN NOT NULL DEFAULT false;

-- Add comment for clarity
COMMENT ON COLUMN public.employees.odometer_tracking_enabled IS 'When true, employee must upload odometer photos at shift start/end';
COMMENT ON COLUMN public.employees.task_proof_enabled IS 'When true, employee must upload task proof photos as configured per shift';
