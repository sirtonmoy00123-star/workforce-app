-- ============================================================
-- Migration 025: Leave Management + Roster Enhancements (Phase 6)
-- ============================================================

-- ── Leave types enum ──
DO $$ BEGIN
  CREATE TYPE leave_type AS ENUM ('ANNUAL', 'SICK', 'PERSONAL', 'UNPAID', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE leave_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Employee Leave table ──
CREATE TABLE IF NOT EXISTS employee_leave (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id),
  employee_id   UUID NOT NULL REFERENCES employees(id),
  leave_type    leave_type NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  status        leave_status NOT NULL DEFAULT 'PENDING',
  employee_note TEXT,
  admin_note    TEXT,
  reviewed_by   UUID REFERENCES users(id),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_leave_dates CHECK (end_date >= start_date)
);

-- Indexes for leave lookups
CREATE INDEX IF NOT EXISTS idx_leave_business ON employee_leave(business_id);
CREATE INDEX IF NOT EXISTS idx_leave_employee ON employee_leave(employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_dates ON employee_leave(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_status ON employee_leave(status);
-- Fast overlap check: "any approved leave overlapping a date range?"
CREATE INDEX IF NOT EXISTS idx_leave_approved_range
  ON employee_leave(employee_id, status, start_date, end_date)
  WHERE status = 'APPROVED';

-- ── RLS for employee_leave ──
ALTER TABLE employee_leave ENABLE ROW LEVEL SECURITY;

-- Admins can see all leave in their business
CREATE POLICY leave_admin_select ON employee_leave
  FOR SELECT USING (
    business_id IN (
      SELECT bm.business_id FROM business_members bm
      JOIN users u ON u.id = bm.user_id
      WHERE u.auth_user_id = auth.uid()
      AND bm.role IN ('OWNER', 'ADMIN')
      AND bm.status = 'ACTIVE'
    )
  );

-- Employees can see their own leave
CREATE POLICY leave_employee_select ON employee_leave
  FOR SELECT USING (
    employee_id IN (
      SELECT e.id FROM employees e
      JOIN users u ON u.id = e.user_id
      WHERE u.auth_user_id = auth.uid()
    )
  );

-- Only admins can insert/update/delete leave (via service role in practice)
CREATE POLICY leave_admin_insert ON employee_leave
  FOR INSERT WITH CHECK (
    business_id IN (
      SELECT bm.business_id FROM business_members bm
      JOIN users u ON u.id = bm.user_id
      WHERE u.auth_user_id = auth.uid()
      AND bm.role IN ('OWNER', 'ADMIN')
      AND bm.status = 'ACTIVE'
    )
  );

CREATE POLICY leave_admin_update ON employee_leave
  FOR UPDATE USING (
    business_id IN (
      SELECT bm.business_id FROM business_members bm
      JOIN users u ON u.id = bm.user_id
      WHERE u.auth_user_id = auth.uid()
      AND bm.role IN ('OWNER', 'ADMIN')
      AND bm.status = 'ACTIVE'
    )
  );

-- Employees can insert their own leave requests
CREATE POLICY leave_employee_insert ON employee_leave
  FOR INSERT WITH CHECK (
    employee_id IN (
      SELECT e.id FROM employees e
      JOIN users u ON u.id = e.user_id
      WHERE u.auth_user_id = auth.uid()
    )
  );

-- ── Roster draft support: add draft status to shifts ──
-- Add 'draft' to shift_status enum if not already there
DO $$ BEGIN
  ALTER TYPE shift_status ADD VALUE IF NOT EXISTS 'draft' BEFORE 'pending';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Roster week concept ──
CREATE TABLE IF NOT EXISTS roster_weeks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id),
  week_start    DATE NOT NULL,
  week_end      DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'DRAFT'
                CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  total_shifts  INTEGER NOT NULL DEFAULT 0,
  total_hours   NUMERIC(10,2) NOT NULL DEFAULT 0,
  estimated_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  published_at  TIMESTAMPTZ,
  published_by  UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_roster_week UNIQUE (business_id, week_start)
);

ALTER TABLE roster_weeks ENABLE ROW LEVEL SECURITY;

CREATE POLICY roster_weeks_admin ON roster_weeks
  FOR ALL USING (
    business_id IN (
      SELECT bm.business_id FROM business_members bm
      JOIN users u ON u.id = bm.user_id
      WHERE u.auth_user_id = auth.uid()
      AND bm.role IN ('OWNER', 'ADMIN')
      AND bm.status = 'ACTIVE'
    )
  );

-- ── Roster Templates ──
CREATE TABLE IF NOT EXISTS roster_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id),
  name          TEXT NOT NULL,
  description   TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roster_template_shifts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   UUID NOT NULL REFERENCES roster_templates(id) ON DELETE CASCADE,
  day_of_week   INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  employee_id   UUID REFERENCES employees(id),
  role_label    TEXT,
  location      TEXT,
  location_id   UUID REFERENCES work_locations(id),
  instructions  TEXT,
  require_odometer  BOOLEAN,
  require_attendance BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_template_shifts_template ON roster_template_shifts(template_id);

ALTER TABLE roster_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_template_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY roster_templates_admin ON roster_templates
  FOR ALL USING (
    business_id IN (
      SELECT bm.business_id FROM business_members bm
      JOIN users u ON u.id = bm.user_id
      WHERE u.auth_user_id = auth.uid()
      AND bm.role IN ('OWNER', 'ADMIN')
      AND bm.status = 'ACTIVE'
    )
  );

CREATE POLICY roster_template_shifts_admin ON roster_template_shifts
  FOR ALL USING (
    template_id IN (
      SELECT id FROM roster_templates WHERE business_id IN (
        SELECT bm.business_id FROM business_members bm
        JOIN users u ON u.id = bm.user_id
        WHERE u.auth_user_id = auth.uid()
        AND bm.role IN ('OWNER', 'ADMIN')
        AND bm.status = 'ACTIVE'
      )
    )
  );

-- ── Allow unfilled shifts (employee_id nullable on shifts) ──
-- The shifts table already has employee_id — make it nullable for unfilled shifts
ALTER TABLE shifts ALTER COLUMN employee_id DROP NOT NULL;
