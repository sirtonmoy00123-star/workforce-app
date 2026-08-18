-- ============================================================
-- 007: Event Staffing & Open Shift Offers
--
-- New tables:
--   staffing_events
--   event_staffing_requirements
--   open_shift_offers
--   open_shift_offer_recipients
--   event_audit_log
--
-- Altered tables:
--   employees  → add employment_type, open_to_extra_shifts
--   shifts     → add event_id
--
-- New function:
--   accept_open_shift_offer() — atomic acceptance with row locking
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. New ENUM types
-- ────────────────────────────────────────────────────────────
CREATE TYPE public.staffing_event_status AS ENUM (
  'DRAFT', 'OPEN', 'PARTIALLY_FILLED', 'FULLY_STAFFED', 'CANCELLED', 'COMPLETED'
);

CREATE TYPE public.open_offer_status AS ENUM (
  'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CLOSED', 'CANCELLED'
);

CREATE TYPE public.offer_recipient_status AS ENUM (
  'PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CLOSED'
);

CREATE TYPE public.employment_type AS ENUM (
  'PERMANENT', 'PART_TIME', 'CASUAL'
);

-- ────────────────────────────────────────────────────────────
-- 2. Alter employees table
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.employees
  ADD COLUMN employment_type public.employment_type NOT NULL DEFAULT 'PERMANENT';

ALTER TABLE public.employees
  ADD COLUMN open_to_extra_shifts BOOLEAN NOT NULL DEFAULT false;

-- ────────────────────────────────────────────────────────────
-- 3. staffing_events
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.staffing_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  description           TEXT,
  event_date            DATE NOT NULL,
  location              TEXT,
  start_time            TIMESTAMPTZ NOT NULL,
  finish_time           TIMESTAMPTZ NOT NULL,
  status                public.staffing_event_status NOT NULL DEFAULT 'DRAFT',
  reminder_days_before  SMALLINT DEFAULT 7,
  created_by            UUID REFERENCES public.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_staffing_events_business_date ON public.staffing_events(business_id, event_date);
CREATE INDEX idx_staffing_events_status ON public.staffing_events(business_id, status);

ALTER TABLE public.staffing_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staffing_events_all" ON public.staffing_events FOR ALL USING (true);

-- ────────────────────────────────────────────────────────────
-- 4. event_staffing_requirements
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.event_staffing_requirements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  event_id          UUID NOT NULL REFERENCES public.staffing_events(id) ON DELETE CASCADE,
  role              TEXT NOT NULL DEFAULT 'General',
  required_count    SMALLINT NOT NULL CHECK (required_count > 0),
  filled_count      SMALLINT NOT NULL DEFAULT 0,
  start_time        TIMESTAMPTZ NOT NULL,
  finish_time       TIMESTAMPTZ NOT NULL,
  instructions      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_requirements_event ON public.event_staffing_requirements(event_id);

ALTER TABLE public.event_staffing_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_staffing_requirements_all" ON public.event_staffing_requirements FOR ALL USING (true);

-- ────────────────────────────────────────────────────────────
-- 5. open_shift_offers
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.open_shift_offers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  event_id            UUID NOT NULL REFERENCES public.staffing_events(id) ON DELETE CASCADE,
  requirement_id      UUID NOT NULL REFERENCES public.event_staffing_requirements(id) ON DELETE CASCADE,
  role                TEXT NOT NULL DEFAULT 'General',
  positions_required  SMALLINT NOT NULL CHECK (positions_required > 0),
  positions_filled    SMALLINT NOT NULL DEFAULT 0,
  status              public.open_offer_status NOT NULL DEFAULT 'OPEN',
  expires_at          TIMESTAMPTZ,
  created_by          UUID REFERENCES public.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_open_offers_business_status ON public.open_shift_offers(business_id, status);
CREATE INDEX idx_open_offers_event ON public.open_shift_offers(event_id);

ALTER TABLE public.open_shift_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_shift_offers_all" ON public.open_shift_offers FOR ALL USING (true);

-- ────────────────────────────────────────────────────────────
-- 6. open_shift_offer_recipients
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.open_shift_offer_recipients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  offer_id      UUID NOT NULL REFERENCES public.open_shift_offers(id) ON DELETE CASCADE,
  employee_id   UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  status        public.offer_recipient_status NOT NULL DEFAULT 'PENDING',
  shift_id      UUID REFERENCES public.shifts(id),  -- set when accepted → shift created
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at  TIMESTAMPTZ,
  UNIQUE (offer_id, employee_id)
);

CREATE INDEX idx_offer_recipients_offer ON public.open_shift_offer_recipients(offer_id);
CREATE INDEX idx_offer_recipients_employee ON public.open_shift_offer_recipients(employee_id, status);

ALTER TABLE public.open_shift_offer_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open_shift_offer_recipients_all" ON public.open_shift_offer_recipients FOR ALL USING (true);

-- ────────────────────────────────────────────────────────────
-- 7. Add event_id to shifts
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.shifts
  ADD COLUMN event_id UUID REFERENCES public.staffing_events(id);

CREATE INDEX idx_shifts_event ON public.shifts(event_id) WHERE event_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 8. event_audit_log
-- ────────────────────────────────────────────────────────────
CREATE TABLE public.event_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  event_id      UUID NOT NULL REFERENCES public.staffing_events(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,  -- e.g. 'created', 'edited', 'worker_assigned', 'offer_sent', 'worker_accepted', 'cancelled'
  details       JSONB,
  performed_by  UUID REFERENCES public.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_audit_event ON public.event_audit_log(event_id);

ALTER TABLE public.event_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_audit_log_all" ON public.event_audit_log FOR ALL USING (true);

-- ────────────────────────────────────────────────────────────
-- 9. Atomic open-offer acceptance function
--    Uses SELECT ... FOR UPDATE to prevent overfilling.
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
  SELECT id, positions_required, positions_filled, status
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

  -- 3. Check positions remaining
  v_remaining := v_offer.positions_required - v_offer.positions_filled;
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'This shift is now fully staffed.');
  END IF;

  -- 4. Check recipient exists and is PENDING
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

  -- 5. Reserve the position: increment filled count
  UPDATE public.open_shift_offers
     SET positions_filled = positions_filled + 1,
         status = CASE
           WHEN positions_filled + 1 >= positions_required THEN 'FILLED'::public.open_offer_status
           ELSE 'PARTIALLY_FILLED'::public.open_offer_status
         END,
         updated_at = now()
   WHERE id = p_offer_id;

  -- 6. Mark recipient as accepted
  UPDATE public.open_shift_offer_recipients
     SET status = 'ACCEPTED'::public.offer_recipient_status,
         responded_at = now()
   WHERE id = p_recipient_id;

  -- 7. Update requirement filled count
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
-- 10. Updated_at triggers for new tables
-- ────────────────────────────────────────────────────────────
-- Reuse the existing set_updated_at() trigger function if it exists,
-- otherwise create it.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_staffing_events_updated_at
  BEFORE UPDATE ON public.staffing_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_event_requirements_updated_at
  BEFORE UPDATE ON public.event_staffing_requirements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_open_offers_updated_at
  BEFORE UPDATE ON public.open_shift_offers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
