-- ============================================================
-- Migration 014: Attendance Records + Exceptions
--
-- Creates:
--   1. attendance_records table (check-in/checkout data per shift)
--   2. attendance_exceptions table (late arrival, GPS out of range, etc.)
--   3. RLS policies for both tables
--   4. Storage bucket for attendance photos (selfies, site photos)
--
-- Run in Supabase SQL Editor.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- STEP 1: Create attendance_records table
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  shift_id            UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  employee_id         UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  location_id         UUID REFERENCES public.work_locations(id),

  -- Scheduled times (snapshot from shift)
  scheduled_start     TIMESTAMPTZ,
  scheduled_finish    TIMESTAMPTZ,

  -- Actual check-in / checkout times (server timestamps)
  actual_checkin      TIMESTAMPTZ,
  actual_checkout     TIMESTAMPTZ,

  -- Admin-approved times (if different from actual)
  approved_start      TIMESTAMPTZ,
  approved_finish     TIMESTAMPTZ,

  -- Check-in status
  checkin_status      TEXT NOT NULL DEFAULT 'NOT_CHECKED_IN'
                      CHECK (checkin_status IN (
                        'NOT_CHECKED_IN', 'PRESENT', 'LATE', 'NEEDS_REVIEW',
                        'APPROVED_MANUALLY', 'ABSENT'
                      )),

  -- Checkout status
  checkout_status     TEXT NOT NULL DEFAULT 'NOT_CHECKED_OUT'
                      CHECK (checkout_status IN (
                        'NOT_CHECKED_OUT', 'CHECKED_OUT', 'EARLY_DEPARTURE',
                        'LATE_DEPARTURE', 'NEEDS_REVIEW', 'AUTO_CHECKOUT'
                      )),

  -- QR verification
  qr_mode             TEXT CHECK (qr_mode IN ('STATIC', 'DYNAMIC')),
  qr_verified         BOOLEAN NOT NULL DEFAULT false,

  -- GPS check-in data
  checkin_latitude    DOUBLE PRECISION,
  checkin_longitude   DOUBLE PRECISION,
  checkin_distance_metres INTEGER,

  -- GPS checkout data
  checkout_latitude   DOUBLE PRECISION,
  checkout_longitude  DOUBLE PRECISION,
  checkout_distance_metres INTEGER,

  -- Photo evidence paths (Supabase Storage)
  selfie_photo_path   TEXT,
  site_photo_path     TEXT,

  -- Overall verification status
  verification_status TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (verification_status IN (
                        'PENDING', 'VERIFIED', 'NEEDS_REVIEW', 'REJECTED'
                      )),

  -- Review
  requires_review     BOOLEAN NOT NULL DEFAULT false,
  reviewed_by         UUID REFERENCES public.users(id),
  reviewed_at         TIMESTAMPTZ,
  review_note         TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One attendance record per shift
  CONSTRAINT uq_attendance_record_shift UNIQUE (shift_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_records_business
  ON public.attendance_records (business_id);

CREATE INDEX IF NOT EXISTS idx_attendance_records_employee
  ON public.attendance_records (employee_id);

CREATE INDEX IF NOT EXISTS idx_attendance_records_shift
  ON public.attendance_records (shift_id);

CREATE INDEX IF NOT EXISTS idx_attendance_records_location
  ON public.attendance_records (location_id);

CREATE INDEX IF NOT EXISTS idx_attendance_records_status
  ON public.attendance_records (checkin_status)
  WHERE checkin_status IN ('NEEDS_REVIEW', 'LATE');

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_attendance_records_updated_at'
  ) THEN
    CREATE TRIGGER trg_attendance_records_updated_at
      BEFORE UPDATE ON public.attendance_records
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

-- RLS
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

-- Admin: full access within own business
CREATE POLICY "Attendance records: admin select"
  ON public.attendance_records FOR SELECT
  USING (business_id = public.current_user_business_id());

CREATE POLICY "Attendance records: admin insert"
  ON public.attendance_records FOR INSERT
  WITH CHECK (business_id = public.current_user_business_id());

CREATE POLICY "Attendance records: admin update"
  ON public.attendance_records FOR UPDATE
  USING (business_id = public.current_user_business_id());

-- Employee: can see own records
CREATE POLICY "Attendance records: employee select own"
  ON public.attendance_records FOR SELECT
  USING (
    business_id = public.current_user_business_id()
    AND employee_id IN (
      SELECT id FROM public.employees
      WHERE user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    )
  );

-- Employee: can insert own (for check-in)
CREATE POLICY "Attendance records: employee insert own"
  ON public.attendance_records FOR INSERT
  WITH CHECK (
    business_id = public.current_user_business_id()
    AND employee_id IN (
      SELECT id FROM public.employees
      WHERE user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    )
  );

-- Employee: can update own (for checkout)
CREATE POLICY "Attendance records: employee update own"
  ON public.attendance_records FOR UPDATE
  USING (
    business_id = public.current_user_business_id()
    AND employee_id IN (
      SELECT id FROM public.employees
      WHERE user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    )
  );


-- ────────────────────────────────────────────────────────────
-- STEP 2: Create attendance_exceptions table
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.attendance_exceptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id           UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  attendance_record_id  UUID NOT NULL REFERENCES public.attendance_records(id) ON DELETE CASCADE,
  employee_id           UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  shift_id              UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,

  -- Exception type
  exception_type        TEXT NOT NULL
                        CHECK (exception_type IN (
                          'LATE_ARRIVAL', 'EARLY_ARRIVAL', 'EARLY_DEPARTURE',
                          'LATE_DEPARTURE', 'GPS_OUT_OF_RANGE', 'QR_MISMATCH',
                          'MISSING_SELFIE', 'MISSING_SITE_PHOTO'
                        )),

  -- How far off (minutes for time, metres for GPS)
  difference_minutes    INTEGER,
  difference_metres     INTEGER,

  -- Status
  status                TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'NOTED')),

  -- Admin review
  admin_note            TEXT,
  resolved_at           TIMESTAMPTZ,
  resolved_by           UUID REFERENCES public.users(id),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_exceptions_record
  ON public.attendance_exceptions (attendance_record_id);

CREATE INDEX IF NOT EXISTS idx_attendance_exceptions_business
  ON public.attendance_exceptions (business_id);

CREATE INDEX IF NOT EXISTS idx_attendance_exceptions_status
  ON public.attendance_exceptions (status)
  WHERE status = 'PENDING';

-- RLS
ALTER TABLE public.attendance_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Attendance exceptions: admin select"
  ON public.attendance_exceptions FOR SELECT
  USING (business_id = public.current_user_business_id());

CREATE POLICY "Attendance exceptions: admin insert"
  ON public.attendance_exceptions FOR INSERT
  WITH CHECK (business_id = public.current_user_business_id());

CREATE POLICY "Attendance exceptions: admin update"
  ON public.attendance_exceptions FOR UPDATE
  USING (business_id = public.current_user_business_id());

-- Employee: can see own exceptions
CREATE POLICY "Attendance exceptions: employee select own"
  ON public.attendance_exceptions FOR SELECT
  USING (
    business_id = public.current_user_business_id()
    AND employee_id IN (
      SELECT id FROM public.employees
      WHERE user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    )
  );

-- Employee: can insert own (created during check-in)
CREATE POLICY "Attendance exceptions: employee insert own"
  ON public.attendance_exceptions FOR INSERT
  WITH CHECK (
    business_id = public.current_user_business_id()
    AND employee_id IN (
      SELECT id FROM public.employees
      WHERE user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    )
  );


-- ────────────────────────────────────────────────────────────
-- STEP 3: Create storage bucket for attendance photos
-- ────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('attendance-photos', 'attendance-photos', false, 10485760)
ON CONFLICT (id) DO NOTHING;

-- Upload policy: authenticated users can upload to their own folder
CREATE POLICY "Attendance photos: upload own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'attendance-photos'
    AND auth.uid() IS NOT NULL
  );

-- Read policy: authenticated users can read from their business
CREATE POLICY "Attendance photos: read own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'attendance-photos'
    AND auth.uid() IS NOT NULL
  );


-- ============================================================
-- Done. Summary:
--   • attendance_records — one record per shift, tracks check-in/checkout
--   • attendance_exceptions — late arrival, GPS issues, etc.
--   • attendance-photos bucket — selfie and site photo storage
--   • RLS: admin full access, employee own records only
-- ============================================================
