-- ============================================================
-- Migration 012: Attendance Phase 1 — Work Locations + Attendance Settings
--
-- Creates:
--   1. work_locations table (structured locations with GPS coordinates)
--   2. attendance_settings table (per-location attendance config)
--   3. Optional location_id FK on shifts (keeps existing TEXT location)
--   4. RLS policies for both new tables
--   5. Indexes for performance
--
-- Run in Supabase SQL Editor. All operations are idempotent.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- STEP 1: Create work_locations table
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.work_locations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,                -- e.g. "Campbelltown Site"
  address         TEXT,                         -- street address
  latitude        DOUBLE PRECISION,             -- GPS lat for geofencing
  longitude       DOUBLE PRECISION,             -- GPS lng for geofencing

  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'ARCHIVED')),

  created_by      UUID REFERENCES public.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique name per business
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_locations_biz_name
  ON public.work_locations (business_id, name)
  WHERE status = 'ACTIVE';

-- Lookup by business
CREATE INDEX IF NOT EXISTS idx_work_locations_business
  ON public.work_locations (business_id);

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_work_locations_updated_at'
  ) THEN
    CREATE TRIGGER trg_work_locations_updated_at
      BEFORE UPDATE ON public.work_locations
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

-- RLS
ALTER TABLE public.work_locations ENABLE ROW LEVEL SECURITY;

-- Admin: full CRUD within own business
CREATE POLICY "Work locations: admin select"
  ON public.work_locations FOR SELECT
  USING (business_id = public.current_user_business_id());

CREATE POLICY "Work locations: admin insert"
  ON public.work_locations FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

CREATE POLICY "Work locations: admin update"
  ON public.work_locations FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

CREATE POLICY "Work locations: admin delete"
  ON public.work_locations FOR DELETE
  USING (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

-- Employees can see locations in their business (needed for check-in UI)
CREATE POLICY "Work locations: employee select"
  ON public.work_locations FOR SELECT
  USING (
    public.current_user_role() = 'employee'
    AND business_id = public.current_user_business_id()
  );


-- ────────────────────────────────────────────────────────────
-- STEP 2: Create attendance_settings table (1:1 with work_locations)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.attendance_settings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  location_id         UUID NOT NULL REFERENCES public.work_locations(id) ON DELETE CASCADE,

  -- Master toggle
  attendance_required BOOLEAN NOT NULL DEFAULT false,

  -- QR verification
  qr_required         BOOLEAN NOT NULL DEFAULT false,
  qr_mode             TEXT NOT NULL DEFAULT 'STATIC'
                      CHECK (qr_mode IN ('STATIC', 'DYNAMIC')),

  -- GPS verification
  gps_required        BOOLEAN NOT NULL DEFAULT false,
  allowed_radius_metres INTEGER NOT NULL DEFAULT 100,

  -- Photo verification
  selfie_required     BOOLEAN NOT NULL DEFAULT false,
  site_photo_required BOOLEAN NOT NULL DEFAULT false,

  -- Time thresholds (minutes)
  early_checkin_minutes          INTEGER NOT NULL DEFAULT 15,
  late_grace_minutes             INTEGER NOT NULL DEFAULT 10,
  early_departure_review_minutes INTEGER NOT NULL DEFAULT 10,
  late_finish_review_minutes     INTEGER NOT NULL DEFAULT 15,

  -- Time rounding (0 = none)
  rounding_minutes    INTEGER NOT NULL DEFAULT 0
                      CHECK (rounding_minutes IN (0, 5, 10, 15, 30)),

  -- Checkout method
  checkout_method     TEXT NOT NULL DEFAULT 'BUTTON_ONLY'
                      CHECK (checkout_method IN (
                        'BUTTON_ONLY', 'GPS_ONLY', 'QR_GPS', 'QR_GPS_SELFIE'
                      )),

  -- Dynamic QR refresh interval (seconds)
  dynamic_qr_refresh_seconds INTEGER NOT NULL DEFAULT 60,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One settings row per location
  CONSTRAINT uq_attendance_settings_location UNIQUE (location_id)
);

-- Lookup by business
CREATE INDEX IF NOT EXISTS idx_attendance_settings_business
  ON public.attendance_settings (business_id);

-- Lookup by location
CREATE INDEX IF NOT EXISTS idx_attendance_settings_location
  ON public.attendance_settings (location_id);

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_attendance_settings_updated_at'
  ) THEN
    CREATE TRIGGER trg_attendance_settings_updated_at
      BEFORE UPDATE ON public.attendance_settings
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

-- RLS
ALTER TABLE public.attendance_settings ENABLE ROW LEVEL SECURITY;

-- Admin: full CRUD within own business
CREATE POLICY "Attendance settings: admin select"
  ON public.attendance_settings FOR SELECT
  USING (business_id = public.current_user_business_id());

CREATE POLICY "Attendance settings: admin insert"
  ON public.attendance_settings FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

CREATE POLICY "Attendance settings: admin update"
  ON public.attendance_settings FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

CREATE POLICY "Attendance settings: admin delete"
  ON public.attendance_settings FOR DELETE
  USING (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

-- Employees can read settings (needed for check-in flow)
CREATE POLICY "Attendance settings: employee select"
  ON public.attendance_settings FOR SELECT
  USING (
    public.current_user_role() = 'employee'
    AND business_id = public.current_user_business_id()
  );


-- ────────────────────────────────────────────────────────────
-- STEP 3: Add optional location_id FK to shifts
--
-- Keeps existing TEXT `location` column for backward compat.
-- New shifts can link to a work_location; old ones keep NULL.
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shifts'
      AND column_name = 'location_id'
  ) THEN
    ALTER TABLE public.shifts
      ADD COLUMN location_id UUID REFERENCES public.work_locations(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_shifts_location_id
  ON public.shifts (location_id)
  WHERE location_id IS NOT NULL;


-- ============================================================
-- Done. Summary:
--   • work_locations — structured locations with GPS, RLS, unique name per biz
--   • attendance_settings — 1:1 with location, all config fields from spec
--   • shifts.location_id — optional FK to work_locations (backward compat)
-- ============================================================
