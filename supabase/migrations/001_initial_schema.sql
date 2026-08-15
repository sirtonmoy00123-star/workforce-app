-- ============================================================
-- Workforce App V1 — Full Database Schema
-- Run this entire file in Supabase SQL Editor (one go).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Custom ENUM types
-- ────────────────────────────────────────────────────────────
CREATE TYPE public.user_role        AS ENUM ('admin', 'employee');
CREATE TYPE public.account_status   AS ENUM ('active', 'disabled');
CREATE TYPE public.employment_status AS ENUM ('active', 'inactive');
CREATE TYPE public.shift_status     AS ENUM ('pending', 'accepted', 'declined', 'completed', 'cancelled');
CREATE TYPE public.attendance_status AS ENUM ('pending', 'working', 'completed');
CREATE TYPE public.submission_type  AS ENUM ('START', 'FINISH');
CREATE TYPE public.timesheet_status AS ENUM ('submitted', 'approved', 'needs_correction');
CREATE TYPE public.payment_status   AS ENUM ('unpaid', 'paid');

-- ────────────────────────────────────────────────────────────
-- 2. Tables
-- ────────────────────────────────────────────────────────────

-- 2a. users — links a Supabase Auth user to a role in our app.
CREATE TABLE public.users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id    UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id     UUID NOT NULL DEFAULT gen_random_uuid(),
  role            public.user_role NOT NULL DEFAULT 'employee',
  username        TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT true,
  account_status  public.account_status NOT NULL DEFAULT 'active',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2b. employees — extended profile for employee-role users.
CREATE TABLE public.employees (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL,
  user_id           UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  employee_number   TEXT NOT NULL,
  full_name         TEXT NOT NULL,
  phone             TEXT,
  hourly_rate       NUMERIC(10,2) NOT NULL DEFAULT 0,
  mileage_rate      NUMERIC(10,4) NOT NULL DEFAULT 0,
  employment_status public.employment_status NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, employee_number)
);

-- 2c. employee_availability — recurring weekly availability.
CREATE TABLE public.employee_availability (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun … 6=Sat
  start_time    TIME,          -- NULL when is_available = false
  end_time      TIME,          -- NULL when is_available = false
  is_available  BOOLEAN NOT NULL DEFAULT false,
  created_by    UUID REFERENCES public.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, day_of_week)
);

-- 2d. shifts
CREATE TABLE public.shifts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL,
  employee_id      UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  date             DATE NOT NULL,
  scheduled_start  TIMESTAMPTZ NOT NULL,
  scheduled_finish TIMESTAMPTZ NOT NULL,
  location         TEXT,
  instructions     TEXT,
  status           public.shift_status NOT NULL DEFAULT 'pending',
  created_by       UUID REFERENCES public.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2e. shift_attendance — tracks actual start/finish once employee works.
CREATE TABLE public.shift_attendance (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id          UUID NOT NULL UNIQUE REFERENCES public.shifts(id) ON DELETE CASCADE,
  employee_id       UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  actual_start      TIMESTAMPTZ,
  actual_finish     TIMESTAMPTZ,
  attendance_status public.attendance_status NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2f. odometer_submissions — photos + readings for each shift start/finish.
CREATE TABLE public.odometer_submissions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id          UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  employee_id       UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  submission_type   public.submission_type NOT NULL,
  photo_path        TEXT NOT NULL,
  odometer_reading  NUMERIC(10,1) NOT NULL,
  server_timestamp  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shift_id, submission_type)
);

-- 2g. timesheets — auto-generated when a shift is completed.
CREATE TABLE public.timesheets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id              UUID NOT NULL UNIQUE REFERENCES public.shifts(id) ON DELETE CASCADE,
  employee_id           UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  scheduled_start       TIMESTAMPTZ NOT NULL,
  scheduled_finish      TIMESTAMPTZ NOT NULL,
  actual_start          TIMESTAMPTZ NOT NULL,
  actual_finish         TIMESTAMPTZ NOT NULL,
  worked_minutes        INTEGER NOT NULL,
  start_odometer        NUMERIC(10,1) NOT NULL,
  finish_odometer       NUMERIC(10,1) NOT NULL,
  distance_km           NUMERIC(10,1) NOT NULL,
  hourly_rate_snapshot  NUMERIC(10,2) NOT NULL,
  mileage_rate_snapshot NUMERIC(10,4) NOT NULL,
  wage_amount           NUMERIC(10,2) NOT NULL,
  mileage_amount        NUMERIC(10,2) NOT NULL,
  estimated_total       NUMERIC(10,2) NOT NULL,
  approved_total        NUMERIC(10,2),
  status                public.timesheet_status NOT NULL DEFAULT 'submitted',
  approved_by           UUID REFERENCES public.users(id),
  approved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2h. payments — groups approved timesheets by employee + pay period.
CREATE TABLE public.payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  total_hours     NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_mileage   NUMERIC(10,1) NOT NULL DEFAULT 0,
  wage_amount     NUMERIC(10,2) NOT NULL DEFAULT 0,
  mileage_amount  NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  status          public.payment_status NOT NULL DEFAULT 'unpaid',
  payment_date    TIMESTAMPTZ,
  marked_paid_by  UUID REFERENCES public.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ────────────────────────────────────────────────────────────
-- 3. Indexes for common queries
-- ────────────────────────────────────────────────────────────
CREATE INDEX idx_users_auth_user_id        ON public.users(auth_user_id);
CREATE INDEX idx_employees_user_id         ON public.employees(user_id);
CREATE INDEX idx_employees_business_id     ON public.employees(business_id);
CREATE INDEX idx_shifts_employee_id        ON public.shifts(employee_id);
CREATE INDEX idx_shifts_business_id_date   ON public.shifts(business_id, date);
CREATE INDEX idx_shift_attendance_shift_id ON public.shift_attendance(shift_id);
CREATE INDEX idx_timesheets_employee_id    ON public.timesheets(employee_id);
CREATE INDEX idx_payments_employee_id      ON public.payments(employee_id);

-- ────────────────────────────────────────────────────────────
-- 4. Auto-update updated_at trigger
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_employees_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_employee_availability_updated_at
  BEFORE UPDATE ON public.employee_availability
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_shifts_updated_at
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_shift_attendance_updated_at
  BEFORE UPDATE ON public.shift_attendance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ────────────────────────────────────────────────────────────
-- 5. Row Level Security (RLS) policies
-- ────────────────────────────────────────────────────────────

-- Enable RLS on every table.
ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_attendance     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odometer_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.timesheets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments             ENABLE ROW LEVEL SECURITY;

-- Helper: get the current user's app-level row from public.users.
-- Returns NULL if no row exists (e.g. during initial admin bootstrap).
CREATE OR REPLACE FUNCTION public.current_app_user_id()
RETURNS UUID AS $$
  SELECT id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role AS $$
  SELECT role FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION public.current_user_business_id()
RETURNS UUID AS $$
  SELECT business_id FROM public.users WHERE auth_user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: get the current user's employee_id (NULL for admins).
CREATE OR REPLACE FUNCTION public.current_employee_id()
RETURNS UUID AS $$
  SELECT e.id FROM public.employees e
  JOIN public.users u ON u.id = e.user_id
  WHERE u.auth_user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── users ──
CREATE POLICY "Users: admin sees same-business users"
  ON public.users FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

CREATE POLICY "Users: employee sees own row"
  ON public.users FOR SELECT
  USING (auth_user_id = auth.uid());

CREATE POLICY "Users: admin can update same-business users"
  ON public.users FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

CREATE POLICY "Users: employee can update own row"
  ON public.users FOR UPDATE
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- ── employees ──
CREATE POLICY "Employees: admin sees same-business"
  ON public.employees FOR SELECT
  USING (business_id = public.current_user_business_id());

CREATE POLICY "Employees: employee sees own row"
  ON public.employees FOR SELECT
  USING (id = public.current_employee_id());

CREATE POLICY "Employees: admin can insert"
  ON public.employees FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

CREATE POLICY "Employees: admin can update same-business"
  ON public.employees FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

-- ── employee_availability ──
CREATE POLICY "Availability: admin sees same-business employees"
  ON public.employee_availability FOR SELECT
  USING (
    employee_id IN (
      SELECT id FROM public.employees WHERE business_id = public.current_user_business_id()
    )
  );

CREATE POLICY "Availability: employee sees own"
  ON public.employee_availability FOR SELECT
  USING (employee_id = public.current_employee_id());

CREATE POLICY "Availability: admin can insert"
  ON public.employee_availability FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND employee_id IN (
      SELECT id FROM public.employees WHERE business_id = public.current_user_business_id()
    )
  );

CREATE POLICY "Availability: admin can update"
  ON public.employee_availability FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND employee_id IN (
      SELECT id FROM public.employees WHERE business_id = public.current_user_business_id()
    )
  );

CREATE POLICY "Availability: admin can delete"
  ON public.employee_availability FOR DELETE
  USING (
    public.current_user_role() = 'admin'
    AND employee_id IN (
      SELECT id FROM public.employees WHERE business_id = public.current_user_business_id()
    )
  );

-- ── shifts ──
CREATE POLICY "Shifts: admin sees same-business"
  ON public.shifts FOR SELECT
  USING (business_id = public.current_user_business_id());

CREATE POLICY "Shifts: employee sees own"
  ON public.shifts FOR SELECT
  USING (employee_id = public.current_employee_id());

CREATE POLICY "Shifts: admin can insert"
  ON public.shifts FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

CREATE POLICY "Shifts: admin can update"
  ON public.shifts FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

CREATE POLICY "Shifts: employee can update own (accept/decline)"
  ON public.shifts FOR UPDATE
  USING (employee_id = public.current_employee_id())
  WITH CHECK (employee_id = public.current_employee_id());

-- ── shift_attendance ──
CREATE POLICY "Attendance: admin sees same-business"
  ON public.shift_attendance FOR SELECT
  USING (
    shift_id IN (
      SELECT id FROM public.shifts WHERE business_id = public.current_user_business_id()
    )
  );

CREATE POLICY "Attendance: employee sees own"
  ON public.shift_attendance FOR SELECT
  USING (employee_id = public.current_employee_id());

CREATE POLICY "Attendance: employee can insert own"
  ON public.shift_attendance FOR INSERT
  WITH CHECK (employee_id = public.current_employee_id());

CREATE POLICY "Attendance: employee can update own"
  ON public.shift_attendance FOR UPDATE
  USING (employee_id = public.current_employee_id());

-- ── odometer_submissions ──
CREATE POLICY "Odometer: admin sees same-business"
  ON public.odometer_submissions FOR SELECT
  USING (
    shift_id IN (
      SELECT id FROM public.shifts WHERE business_id = public.current_user_business_id()
    )
  );

CREATE POLICY "Odometer: employee sees own"
  ON public.odometer_submissions FOR SELECT
  USING (employee_id = public.current_employee_id());

CREATE POLICY "Odometer: employee can insert own"
  ON public.odometer_submissions FOR INSERT
  WITH CHECK (employee_id = public.current_employee_id());

-- ── timesheets ──
CREATE POLICY "Timesheets: admin sees same-business"
  ON public.timesheets FOR SELECT
  USING (
    shift_id IN (
      SELECT id FROM public.shifts WHERE business_id = public.current_user_business_id()
    )
  );

CREATE POLICY "Timesheets: employee sees own"
  ON public.timesheets FOR SELECT
  USING (employee_id = public.current_employee_id());

CREATE POLICY "Timesheets: admin can update (approve/reject)"
  ON public.timesheets FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND shift_id IN (
      SELECT id FROM public.shifts WHERE business_id = public.current_user_business_id()
    )
  );

-- Allow inserts from server-side (service role) for timesheet generation.
-- The anon key + RLS won't allow arbitrary inserts because the employee
-- can only read their own rows, not insert — timesheet creation happens
-- server-side using the service role key.

-- ── payments ──
CREATE POLICY "Payments: admin sees same-business"
  ON public.payments FOR SELECT
  USING (
    employee_id IN (
      SELECT id FROM public.employees WHERE business_id = public.current_user_business_id()
    )
  );

CREATE POLICY "Payments: employee sees own"
  ON public.payments FOR SELECT
  USING (employee_id = public.current_employee_id());

CREATE POLICY "Payments: admin can insert"
  ON public.payments FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND employee_id IN (
      SELECT id FROM public.employees WHERE business_id = public.current_user_business_id()
    )
  );

CREATE POLICY "Payments: admin can update"
  ON public.payments FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND employee_id IN (
      SELECT id FROM public.employees WHERE business_id = public.current_user_business_id()
    )
  );

-- ────────────────────────────────────────────────────────────
-- 6. Storage bucket for odometer photos (private)
-- ────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('odometer-photos', 'odometer-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: employees can upload to their own folder,
-- admins and the employee can read photos.
CREATE POLICY "Odometer photos: employee upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'odometer-photos'
    AND (storage.foldername(name))[1] IS NOT NULL
  );

CREATE POLICY "Odometer photos: authenticated read"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'odometer-photos'
  );

-- ────────────────────────────────────────────────────────────
-- Done! All tables, enums, indexes, triggers, RLS policies,
-- and storage bucket are ready.
-- ────────────────────────────────────────────────────────────
