-- ============================================================
-- Migration 028: Phase 9 — Notifications + Staffing Automation
--
-- 9A: Add structured notification types
-- 9B: Notification preferences per user + business settings
-- 9C-9E: Business notification settings (reminders, missing check-in/out)
-- 9G: Offer expiration check in acceptance function
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Extend notification_type enum with new types
-- ────────────────────────────────────────────────────────────
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'SHIFT_ASSIGNED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'SHIFT_UPDATED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'SHIFT_CANCELLED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'OPEN_SHIFT_AVAILABLE';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'TIMESHEET_APPROVED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'TIMESHEET_CORRECTION';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'PAYMENT_PROCESSED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'LEAVE_APPROVED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'LEAVE_REJECTED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'SHIFT_REMINDER';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'MISSING_CHECKOUT';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'OFFER_RECEIVED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'OFFER_EXPIRED';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'OFFER_ACCEPTED';

-- ────────────────────────────────────────────────────────────
-- 2. Notification channel enum
-- ────────────────────────────────────────────────────────────
CREATE TYPE notification_channel AS ENUM ('in_app', 'push', 'email');

-- ────────────────────────────────────────────────────────────
-- 3. notification_preferences — per-user per-type channel opt-in
--    in_app is always true (required), push/email are opt-in
-- ────────────────────────────────────────────────────────────
CREATE TABLE notification_preferences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Which notification type
  notification_type  notification_type NOT NULL,
  -- Channel toggles
  in_app        BOOLEAN NOT NULL DEFAULT true,   -- always true, included for completeness
  push          BOOLEAN NOT NULL DEFAULT false,   -- future: push notifications
  email         BOOLEAN NOT NULL DEFAULT false,   -- future: email notifications
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, notification_type)
);

CREATE INDEX idx_notif_prefs_user ON notification_preferences(user_id);
CREATE INDEX idx_notif_prefs_business ON notification_preferences(business_id);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

-- Users can read/update their own preferences
CREATE POLICY notif_prefs_select ON notification_preferences
  FOR SELECT USING (
    user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY notif_prefs_update ON notification_preferences
  FOR UPDATE USING (
    user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
  );

-- ────────────────────────────────────────────────────────────
-- 4. business_notification_settings — business-level config
--    Controls reminders, missing check-in/out thresholds
-- ────────────────────────────────────────────────────────────
CREATE TABLE business_notification_settings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,

  -- 9C: Shift reminder intervals (minutes before shift start)
  -- Stored as array of integers, e.g. {1440, 120, 30} = 24h, 2h, 30min
  shift_reminder_minutes  INTEGER[] NOT NULL DEFAULT '{1440, 120}',

  -- 9D: Missing check-in thresholds (minutes after shift start)
  missing_checkin_employee_minutes  INTEGER NOT NULL DEFAULT 5,   -- employee reminder
  missing_checkin_admin_minutes     INTEGER NOT NULL DEFAULT 15,  -- admin alert

  -- 9E: Missing checkout thresholds (minutes after scheduled finish)
  missing_checkout_employee_minutes  INTEGER NOT NULL DEFAULT 15,  -- employee reminder
  missing_checkout_admin_minutes     INTEGER NOT NULL DEFAULT 30,  -- admin alert

  -- Auto-mark absent (spec says: do NOT auto-mark unless explicitly enabled)
  auto_mark_absent  BOOLEAN NOT NULL DEFAULT false,

  -- 9G: Default offer expiry hours (0 = no expiry)
  default_offer_expiry_hours  INTEGER NOT NULL DEFAULT 24,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE business_notification_settings ENABLE ROW LEVEL SECURITY;

-- Admins can read/update their business settings
CREATE POLICY bns_select ON business_notification_settings
  FOR SELECT USING (
    business_id = current_user_business_id()
  );

CREATE POLICY bns_update ON business_notification_settings
  FOR UPDATE USING (
    business_id = current_user_business_id()
  )
  WITH CHECK (
    business_id = current_user_business_id()
  );

-- Trigger for updated_at
CREATE TRIGGER set_notif_prefs_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER set_bns_updated_at
  BEFORE UPDATE ON business_notification_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ────────────────────────────────────────────────────────────
-- 5. Add delivery tracking columns to notifications
-- ────────────────────────────────────────────────────────────
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS channel notification_channel DEFAULT 'in_app',
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'DELIVERED'
    CHECK (delivery_status IN ('PENDING', 'DELIVERED', 'FAILED'));

-- ────────────────────────────────────────────────────────────
-- 6. Add deduplication index — prevent duplicate notifications
--    for the same shift + type + target within a time window
-- ────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup
  ON notifications (business_id, shift_id, type, target_user_id)
  WHERE shift_id IS NOT NULL AND target_user_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 7. Update offer acceptance function to check expires_at
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_open_shift_offer(
  p_offer_id      UUID,
  p_recipient_id  UUID,
  p_employee_id   UUID,
  p_business_id   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_offer         RECORD;
  v_recipient     RECORD;
  v_remaining     SMALLINT;
BEGIN
  -- 1. Lock the offer row
  SELECT id, positions_required, positions_filled, status, expires_at
    INTO v_offer
    FROM public.open_shift_offers
   WHERE id = p_offer_id
     AND business_id = p_business_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Offer not found.');
  END IF;

  -- 2. Check offer is still open
  IF v_offer.status NOT IN ('OPEN', 'PARTIALLY_FILLED') THEN
    RETURN jsonb_build_object('success', false, 'error', 'This shift is now fully staffed.');
  END IF;

  -- 3. Check expiration (Phase 9G)
  IF v_offer.expires_at IS NOT NULL AND v_offer.expires_at < now() THEN
    -- Auto-transition to closed
    UPDATE public.open_shift_offers
       SET status = 'CLOSED'::public.open_offer_status, updated_at = now()
     WHERE id = p_offer_id;
    RETURN jsonb_build_object('success', false, 'error', 'This offer has expired.');
  END IF;

  -- 4. Check positions remaining
  v_remaining := v_offer.positions_required - v_offer.positions_filled;
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'This shift is now fully staffed.');
  END IF;

  -- 5. Check recipient exists and is PENDING
  SELECT id, status
    INTO v_recipient
    FROM public.open_shift_offer_recipients
   WHERE id = p_recipient_id
     AND offer_id = p_offer_id
     AND employee_id = p_employee_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Offer recipient not found.');
  END IF;

  IF v_recipient.status != 'PENDING' THEN
    RETURN jsonb_build_object('success', false, 'error', 'You have already responded to this offer.');
  END IF;

  -- 6. Reserve the position: increment filled count
  UPDATE public.open_shift_offers
     SET positions_filled = positions_filled + 1,
         status = CASE
           WHEN positions_filled + 1 >= positions_required THEN 'FILLED'::public.open_offer_status
           ELSE 'PARTIALLY_FILLED'::public.open_offer_status
         END,
         updated_at = now()
   WHERE id = p_offer_id;

  -- 7. Mark recipient as accepted
  UPDATE public.open_shift_offer_recipients
     SET status = 'ACCEPTED'::public.offer_recipient_status,
         responded_at = now()
   WHERE id = p_recipient_id;

  -- 8. Update requirement filled count
  UPDATE public.event_staffing_requirements
     SET filled_count = filled_count + 1,
         updated_at = now()
   WHERE id = (SELECT requirement_id FROM public.open_shift_offers WHERE id = p_offer_id);

  RETURN jsonb_build_object(
    'success', true,
    'positions_filled', v_offer.positions_filled + 1,
    'positions_required', v_offer.positions_required,
    'offer_now_filled', (v_offer.positions_filled + 1 >= v_offer.positions_required)
  );
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 8. Function to expire pending offer recipients
--    Called via cron or API to auto-expire stale offers
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.expire_pending_offers()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_expired_count INTEGER := 0;
BEGIN
  -- Expire individual recipient offers where the parent offer has expired
  UPDATE public.open_shift_offer_recipients r
     SET status = 'EXPIRED'::public.offer_recipient_status,
         responded_at = now()
    FROM public.open_shift_offers o
   WHERE r.offer_id = o.id
     AND r.status = 'PENDING'
     AND o.expires_at IS NOT NULL
     AND o.expires_at < now();

  GET DIAGNOSTICS v_expired_count = ROW_COUNT;

  -- Close expired offers that are still OPEN/PARTIALLY_FILLED
  UPDATE public.open_shift_offers
     SET status = 'CLOSED'::public.open_offer_status,
         updated_at = now()
   WHERE status IN ('OPEN', 'PARTIALLY_FILLED')
     AND expires_at IS NOT NULL
     AND expires_at < now();

  RETURN v_expired_count;
END;
$$;
