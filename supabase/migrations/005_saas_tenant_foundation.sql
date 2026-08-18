-- ============================================================
-- Migration 005: SaaS Tenant Foundation (Part A)
-- Phase 1 — Step 1, 2, 3 of the conversion.
--
-- Creates: businesses, business_members tables
-- Backfills: default business row, membership rows for all users
-- Adds: FK constraints on existing business_id columns
-- Adds: business_id (NULLABLE) to 6 tables that lack it + backfill
--
-- Does NOT add NOT NULL — that comes in 005b after count verification.
--
-- Run in Supabase SQL Editor. All operations are idempotent.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- STEP 1: Create businesses table
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.businesses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name   TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  email           TEXT,
  phone           TEXT,
  address         TEXT,
  timezone        TEXT NOT NULL DEFAULT 'Australia/Sydney',
  currency        TEXT NOT NULL DEFAULT 'AUD',
  week_starts_on  SMALLINT NOT NULL DEFAULT 1,  -- 1 = Monday (ISO)
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at trigger (reuses existing function from migration 001)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_businesses_updated_at'
  ) THEN
    CREATE TRIGGER trg_businesses_updated_at
      BEFORE UPDATE ON public.businesses
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

-- RLS enabled (policies added in Phase 4)
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────
-- STEP 2: Create business_members table
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.business_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES public.businesses(id),
  user_id         UUID NOT NULL REFERENCES public.users(id),
  role            TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'EMPLOYEE')),
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'INACTIVE', 'INVITED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bm_business_id ON public.business_members(business_id);
CREATE INDEX IF NOT EXISTS idx_bm_user_id ON public.business_members(user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_business_members_updated_at'
  ) THEN
    CREATE TRIGGER trg_business_members_updated_at
      BEFORE UPDATE ON public.business_members
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;


-- ────────────────────────────────────────────────────────────
-- STEP 3: Create default business + backfill members
-- ────────────────────────────────────────────────────────────

-- 3a. Insert the existing business_id as a real businesses row.
--     Uses the earliest-created admin's business_id and username as email.
INSERT INTO public.businesses (id, business_name, slug, email)
SELECT
  u.business_id,
  'Default Business',
  'default',
  u.username
FROM public.users u
WHERE u.role = 'admin'
ORDER BY u.created_at ASC
LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- 3b. Create business_members for all users.
--     Earliest admin → OWNER. Other admins → ADMIN. Employees → EMPLOYEE.
INSERT INTO public.business_members (business_id, user_id, role, status)
SELECT
  u.business_id,
  u.id,
  CASE
    WHEN u.role = 'admin' AND u.id = (
      SELECT id FROM public.users
      WHERE role = 'admin'
      ORDER BY created_at ASC LIMIT 1
    ) THEN 'OWNER'
    WHEN u.role = 'admin' THEN 'ADMIN'
    WHEN u.role = 'employee' THEN 'EMPLOYEE'
  END,
  CASE u.account_status
    WHEN 'active' THEN 'ACTIVE'
    WHEN 'disabled' THEN 'INACTIVE'
  END
FROM public.users u
ON CONFLICT (business_id, user_id) DO NOTHING;


-- ────────────────────────────────────────────────────────────
-- STEP 4: Add FK constraints on EXISTING business_id columns
-- (users, employees, shifts, timesheet_corrections already
--  have business_id but no FK to businesses)
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_users_business' AND table_name = 'users'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT fk_users_business
      FOREIGN KEY (business_id) REFERENCES public.businesses(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_employees_business' AND table_name = 'employees'
  ) THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT fk_employees_business
      FOREIGN KEY (business_id) REFERENCES public.businesses(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_shifts_business' AND table_name = 'shifts'
  ) THEN
    ALTER TABLE public.shifts
      ADD CONSTRAINT fk_shifts_business
      FOREIGN KEY (business_id) REFERENCES public.businesses(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_corrections_business' AND table_name = 'timesheet_corrections'
  ) THEN
    ALTER TABLE public.timesheet_corrections
      ADD CONSTRAINT fk_corrections_business
      FOREIGN KEY (business_id) REFERENCES public.businesses(id);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- STEP 5: Add business_id (NULLABLE) to 6 tables + backfill
-- NOT NULL is NOT added here — that's in 005b after verification.
-- ────────────────────────────────────────────────────────────

-- 5a. employee_availability
ALTER TABLE public.employee_availability
  ADD COLUMN IF NOT EXISTS business_id UUID;

UPDATE public.employee_availability ea
SET business_id = e.business_id
FROM public.employees e
WHERE ea.employee_id = e.id
  AND ea.business_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_availability_business'
      AND table_name = 'employee_availability'
  ) THEN
    ALTER TABLE public.employee_availability
      ADD CONSTRAINT fk_availability_business
      FOREIGN KEY (business_id) REFERENCES public.businesses(id);
  END IF;
END $$;


-- 5b. shift_attendance
ALTER TABLE public.shift_attendance
  ADD COLUMN IF NOT EXISTS business_id UUID;

UPDATE public.shift_attendance sa
SET business_id = s.business_id
FROM public.shifts s
WHERE sa.shift_id = s.id
  AND sa.business_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_attendance_business'
      AND table_name = 'shift_attendance'
  ) THEN
    ALTER TABLE public.shift_attendance
      ADD CONSTRAINT fk_attendance_business
      FOREIGN KEY (business_id) REFERENCES public.businesses(id);
  END IF;
END $$;


-- 5c. odometer_submissions
ALTER TABLE public.odometer_submissions
  ADD COLUMN IF NOT EXISTS business_id UUID;

UPDATE public.odometer_submissions os
SET business_id = s.business_id
FROM public.shifts s
WHERE os.shift_id = s.id
  AND os.business_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_odometer_business'
      AND table_name = 'odometer_submissions'
  ) THEN
    ALTER TABLE public.odometer_submissions
      ADD CONSTRAINT fk_odometer_business
      FOREIGN KEY (business_id) REFERENCES public.businesses(id);
  END IF;
END $$;


-- 5d. timesheets
ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS business_id UUID;

UPDATE public.timesheets t
SET business_id = s.business_id
FROM public.shifts s
WHERE t.shift_id = s.id
  AND t.business_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_timesheets_business'
      AND table_name = 'timesheets'
  ) THEN
    ALTER TABLE public.timesheets
      ADD CONSTRAINT fk_timesheets_business
      FOREIGN KEY (business_id) REFERENCES public.businesses(id);
  END IF;
END $$;


-- 5e. payments
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS business_id UUID;

UPDATE public.payments p
SET business_id = e.business_id
FROM public.employees e
WHERE p.employee_id = e.id
  AND p.business_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_payments_business'
      AND table_name = 'payments'
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT fk_payments_business
      FOREIGN KEY (business_id) REFERENCES public.businesses(id);
  END IF;
END $$;


-- 5f. shift_audit_log
ALTER TABLE public.shift_audit_log
  ADD COLUMN IF NOT EXISTS business_id UUID;

UPDATE public.shift_audit_log sal
SET business_id = s.business_id
FROM public.shifts s
WHERE sal.shift_id = s.id
  AND sal.business_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_audit_business'
      AND table_name = 'shift_audit_log'
  ) THEN
    ALTER TABLE public.shift_audit_log
      ADD CONSTRAINT fk_audit_business
      FOREIGN KEY (business_id) REFERENCES public.businesses(id);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- VERIFICATION QUERIES — run these and share results
-- ────────────────────────────────────────────────────────────
-- After running the migration above, paste this block to verify:
--
-- SELECT 'businesses' AS tbl, count(*) AS total, 0 AS has_biz, 0 AS null_biz FROM public.businesses
-- UNION ALL SELECT 'business_members', count(*), 0, 0 FROM public.business_members
-- UNION ALL SELECT 'users', count(*), count(business_id), count(*) - count(business_id) FROM public.users
-- UNION ALL SELECT 'employees', count(*), count(business_id), count(*) - count(business_id) FROM public.employees
-- UNION ALL SELECT 'employee_availability', count(*), count(business_id), count(*) - count(business_id) FROM public.employee_availability
-- UNION ALL SELECT 'shifts', count(*), count(business_id), count(*) - count(business_id) FROM public.shifts
-- UNION ALL SELECT 'shift_attendance', count(*), count(business_id), count(*) - count(business_id) FROM public.shift_attendance
-- UNION ALL SELECT 'odometer_submissions', count(*), count(business_id), count(*) - count(business_id) FROM public.odometer_submissions
-- UNION ALL SELECT 'timesheets', count(*), count(business_id), count(*) - count(business_id) FROM public.timesheets
-- UNION ALL SELECT 'payments', count(*), count(business_id), count(*) - count(business_id) FROM public.payments
-- UNION ALL SELECT 'shift_audit_log', count(*), count(business_id), count(*) - count(business_id) FROM public.shift_audit_log
-- UNION ALL SELECT 'timesheet_corrections', count(*), count(business_id), count(*) - count(business_id) FROM public.timesheet_corrections;
--
-- Also check who got OWNER:
-- SELECT bm.role, u.username, u.created_at
-- FROM public.business_members bm
-- JOIN public.users u ON u.id = bm.user_id
-- WHERE bm.role = 'OWNER';
