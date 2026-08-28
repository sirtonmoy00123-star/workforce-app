-- ============================================================
-- Migration 022: General audit_events table
--
-- A single audit log for all domain actions. Replaces the
-- shift-specific shift_audit_log for new events (the old table
-- is left in place and not dropped).
-- ============================================================

-- ── 1. Create audit_events table ────────────────────────────
CREATE TABLE public.audit_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  -- Who performed the action
  actor_user_id   UUID NOT NULL REFERENCES public.users(id),
  actor_role      TEXT NOT NULL,   -- 'ADMIN', 'EMPLOYEE', 'OWNER', 'SYSTEM'

  -- What was affected
  entity_type     TEXT NOT NULL,   -- 'shift', 'work_session', 'timesheet', 'payment', 'attendance', 'employee'
  entity_id       UUID NOT NULL,

  -- The action taken
  action          TEXT NOT NULL,   -- e.g. 'SHIFT_CREATED', 'WORK_SESSION_FINISHED', 'TIMESHEET_APPROVED'

  -- State change
  before_json     JSONB,          -- snapshot before (NULL for creates)
  after_json      JSONB,          -- snapshot after  (NULL for deletes)

  -- Context
  reason          TEXT,            -- required for overrides, adjustments, corrections
  metadata        JSONB,          -- any extra context (idempotency key, IP, etc.)

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Indexes ──────────────────────────────────────────────
CREATE INDEX idx_audit_events_business    ON public.audit_events(business_id);
CREATE INDEX idx_audit_events_entity      ON public.audit_events(entity_type, entity_id);
CREATE INDEX idx_audit_events_actor       ON public.audit_events(actor_user_id);
CREATE INDEX idx_audit_events_action      ON public.audit_events(action);
CREATE INDEX idx_audit_events_created     ON public.audit_events(created_at);

-- ── 3. Enable RLS ───────────────────────────────────────────
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

-- Admins can read audit events for their business
CREATE POLICY "Audit: admin reads own business"
  ON public.audit_events FOR SELECT
  USING (
    business_id = public.current_user_business_id()
  );

-- Employees can read audit events they are the actor for
CREATE POLICY "Audit: employee reads own actions"
  ON public.audit_events FOR SELECT
  USING (
    actor_user_id = auth.uid()
  );

-- Inserts are done via service-role client (server-side only).
-- No INSERT policy for regular users — the auditService.ts
-- will use the admin client to write audit events.

-- ── 4. updated_at trigger (not needed — audit events are immutable)


-- ============================================================
-- DONE — audit_events table ready.
--
-- Application change needed (Phase 3):
--   Create src/lib/services/auditService.ts
--   Log events for: SHIFT_CREATED, SHIFT_UPDATED, SHIFT_ACCEPTED,
--   CHECKIN_CREATED, WORK_SESSION_STARTED, WORK_SESSION_FINISHED,
--   TIMESHEET_GENERATED, TIMESHEET_ADJUSTED, TIMESHEET_APPROVED,
--   PAYMENT_MARKED_PAID, ATTENDANCE_OVERRIDDEN
-- ============================================================
