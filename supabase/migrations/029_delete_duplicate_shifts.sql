-- ============================================================
-- Migration 029 — Fix shift deletion FKs + delete duplicate shifts
--
-- Part A: Fix FKs on notifications and open_shift_offer_recipients
--   so shift deletion doesn't fail when those rows reference a shift.
--   Changes REFERENCES shifts(id) → ON DELETE SET NULL.
--
-- Part B: One-time cleanup of duplicate shifts (already run manually).
--   Kept here as documentation of what was done.
-- ============================================================

-- ── Part A: Fix FKs that block shift deletion ──

-- notifications.shift_id — no ON DELETE action → blocks delete
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_shift_id_fkey;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_shift_id_fkey
  FOREIGN KEY (shift_id) REFERENCES public.shifts(id)
  ON DELETE SET NULL;

-- open_shift_offer_recipients.shift_id — same issue
ALTER TABLE public.open_shift_offer_recipients
  DROP CONSTRAINT IF EXISTS open_shift_offer_recipients_shift_id_fkey;

ALTER TABLE public.open_shift_offer_recipients
  ADD CONSTRAINT open_shift_offer_recipients_shift_id_fkey
  FOREIGN KEY (shift_id) REFERENCES public.shifts(id)
  ON DELETE SET NULL;

-- ── Part B: Duplicate cleanup (run manually 2026-08-31) ──
-- Deleted all duplicate unworked shifts (same employee+date+start+finish),
-- keeping the oldest in each group. Only pending/draft/declined with no
-- work_sessions were affected.

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';
