-- ============================================================
-- Migration 010 — Shift deletion (unworked shifts only)
--
-- Allows an admin to permanently delete a shift that was never
-- worked, while PRESERVING the audit record of why it was deleted.
--
-- shift_audit_log.shift_id is currently NOT NULL with a plain FK,
-- so deleting a shift would either be blocked or force us to
-- destroy the audit history. This migration makes the audit row
-- survive the shift it describes:
--   - shift_id becomes nullable
--   - the FK becomes ON DELETE SET NULL
--
-- Nothing is deleted by this migration. Existing audit rows keep
-- their shift_id. The original_* columns already on the table
-- retain the deleted shift's date/time/location/status.
-- ============================================================

-- 1. Record the deleted shift's identity on the audit row itself,
--    so history is still readable after shift_id is nulled out.
ALTER TABLE public.shift_audit_log
  ADD COLUMN IF NOT EXISTS deleted_shift_id UUID;

COMMENT ON COLUMN public.shift_audit_log.deleted_shift_id IS
  'Set when the shift was permanently deleted. Holds the id the row used to point at.';

-- 2. Allow shift_id to be NULL (only ever null for deleted shifts).
ALTER TABLE public.shift_audit_log
  ALTER COLUMN shift_id DROP NOT NULL;

-- 3. Replace the FK so deleting a shift nulls the pointer
--    instead of blocking the delete or cascading the history away.
ALTER TABLE public.shift_audit_log
  DROP CONSTRAINT IF EXISTS shift_audit_log_shift_id_fkey;

ALTER TABLE public.shift_audit_log
  ADD CONSTRAINT shift_audit_log_shift_id_fkey
  FOREIGN KEY (shift_id) REFERENCES public.shifts(id)
  ON DELETE SET NULL;

-- 4. The existing admin-read RLS policy joins through shift_id, which
--    is NULL for deleted shifts. Add a business_id fallback so admins
--    can still read deletion records for their own business.
DROP POLICY IF EXISTS "Admin can read deleted shift audit logs" ON public.shift_audit_log;

CREATE POLICY "Admin can read deleted shift audit logs"
  ON public.shift_audit_log FOR SELECT
  TO authenticated
  USING (
    shift_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_user_id = auth.uid()
        AND u.role = 'admin'
        AND u.business_id = shift_audit_log.business_id
    )
  );

-- 5. Index for looking up deletion records.
CREATE INDEX IF NOT EXISTS idx_shift_audit_deleted_shift_id
  ON public.shift_audit_log(deleted_shift_id)
  WHERE deleted_shift_id IS NOT NULL;

-- 6. Refresh PostgREST's schema cache so the new column is visible.
NOTIFY pgrst, 'reload schema';
