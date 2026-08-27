-- 018: Add payment_id to timesheets to prevent double-counting
--
-- Bug fix: Before this migration, the same approved timesheets could be
-- included in multiple payments because there was no link from timesheet
-- to payment. This column lets us enforce 1:1 timesheet-to-payment
-- mapping and query which timesheets are already paid.

ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_timesheets_payment_id
  ON public.timesheets(payment_id);
