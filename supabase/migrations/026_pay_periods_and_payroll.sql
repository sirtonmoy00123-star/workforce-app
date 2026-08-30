-- ============================================================
-- Migration 026: Pay Periods & Payroll (Phase 7)
-- ============================================================

-- ── Pay period frequency enum ──
DO $$ BEGIN
  CREATE TYPE pay_frequency AS ENUM ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Pay period status enum ──
DO $$ BEGIN
  CREATE TYPE pay_period_status AS ENUM ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'LOCKED', 'PAID', 'REOPENED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Adjustment type enum ──
DO $$ BEGIN
  CREATE TYPE adjustment_type AS ENUM ('BONUS', 'ALLOWANCE', 'REIMBURSEMENT', 'DEDUCTION', 'CORRECTION', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Pay Periods table ──
CREATE TABLE IF NOT EXISTS pay_periods (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id),
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  frequency       pay_frequency NOT NULL DEFAULT 'WEEKLY',
  status          pay_period_status NOT NULL DEFAULT 'DRAFT',

  -- Frozen totals (populated on lock, not recalculated after)
  total_gross       NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_mileage     NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_adjustments NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_payable     NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Lifecycle timestamps
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at   TIMESTAMPTZ,
  approved_by   UUID REFERENCES users(id),
  locked_at     TIMESTAMPTZ,
  locked_by     UUID REFERENCES users(id),
  paid_at       TIMESTAMPTZ,

  CONSTRAINT chk_pay_period_dates CHECK (period_end >= period_start),
  CONSTRAINT uq_pay_period UNIQUE (business_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_pay_period_business ON pay_periods(business_id);
CREATE INDEX IF NOT EXISTS idx_pay_period_dates ON pay_periods(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_pay_period_status ON pay_periods(status);

-- ── RLS for pay_periods ──
ALTER TABLE pay_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY pay_periods_admin ON pay_periods
  FOR ALL USING (
    business_id IN (
      SELECT bm.business_id FROM business_members bm
      JOIN users u ON u.id = bm.user_id
      WHERE u.auth_user_id = auth.uid()
      AND bm.role IN ('OWNER', 'ADMIN')
      AND bm.status = 'ACTIVE'
    )
  );

-- ── Pay Period Items (employee summary per pay period) ──
CREATE TABLE IF NOT EXISTS pay_period_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_period_id   UUID NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES employees(id),
  business_id     UUID NOT NULL REFERENCES businesses(id),

  -- Frozen snapshot values (calculated at lock time)
  ordinary_hours    NUMERIC(10,2) NOT NULL DEFAULT 0,
  payable_minutes   INTEGER NOT NULL DEFAULT 0,
  total_mileage_km  NUMERIC(10,2) NOT NULL DEFAULT 0,
  hourly_rate       NUMERIC(10,2) NOT NULL DEFAULT 0,
  mileage_rate      NUMERIC(10,2) NOT NULL DEFAULT 0,

  -- Calculated totals
  wages             NUMERIC(12,2) NOT NULL DEFAULT 0,
  mileage_payment   NUMERIC(12,2) NOT NULL DEFAULT 0,
  adjustments_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_payable     NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Payment tracking
  payment_status    TEXT NOT NULL DEFAULT 'UNPAID'
                    CHECK (payment_status IN ('UNPAID', 'PAID', 'PARTIAL')),
  paid_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_at           TIMESTAMPTZ,
  payment_reference TEXT,
  payment_note      TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_pay_period_employee UNIQUE (pay_period_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_ppi_pay_period ON pay_period_items(pay_period_id);
CREATE INDEX IF NOT EXISTS idx_ppi_employee ON pay_period_items(employee_id);
CREATE INDEX IF NOT EXISTS idx_ppi_business ON pay_period_items(business_id);

ALTER TABLE pay_period_items ENABLE ROW LEVEL SECURITY;

-- Admin can manage all items in their business
CREATE POLICY ppi_admin ON pay_period_items
  FOR ALL USING (
    business_id IN (
      SELECT bm.business_id FROM business_members bm
      JOIN users u ON u.id = bm.user_id
      WHERE u.auth_user_id = auth.uid()
      AND bm.role IN ('OWNER', 'ADMIN')
      AND bm.status = 'ACTIVE'
    )
  );

-- Employee can see their own items
CREATE POLICY ppi_employee_select ON pay_period_items
  FOR SELECT USING (
    employee_id IN (
      SELECT e.id FROM employees e
      JOIN users u ON u.id = e.user_id
      WHERE u.auth_user_id = auth.uid()
    )
  );

-- ── Link timesheets to pay periods ──
-- Add pay_period_id to timesheets table (nullable — not all timesheets are in a pay period yet)
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS pay_period_id UUID REFERENCES pay_periods(id);
CREATE INDEX IF NOT EXISTS idx_timesheet_pay_period ON timesheets(pay_period_id);

-- ── Payroll Adjustments ──
CREATE TABLE IF NOT EXISTS payroll_adjustments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_period_id   UUID NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES employees(id),
  business_id     UUID NOT NULL REFERENCES businesses(id),

  adjustment_type adjustment_type NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  reason          TEXT NOT NULL,

  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adj_pay_period ON payroll_adjustments(pay_period_id);
CREATE INDEX IF NOT EXISTS idx_adj_employee ON payroll_adjustments(employee_id);

ALTER TABLE payroll_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY adj_admin ON payroll_adjustments
  FOR ALL USING (
    business_id IN (
      SELECT bm.business_id FROM business_members bm
      JOIN users u ON u.id = bm.user_id
      WHERE u.auth_user_id = auth.uid()
      AND bm.role IN ('OWNER', 'ADMIN')
      AND bm.status = 'ACTIVE'
    )
  );

CREATE POLICY adj_employee_select ON payroll_adjustments
  FOR SELECT USING (
    employee_id IN (
      SELECT e.id FROM employees e
      JOIN users u ON u.id = e.user_id
      WHERE u.auth_user_id = auth.uid()
    )
  );

-- ── Payroll Audit Log ──
CREATE TABLE IF NOT EXISTS payroll_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_period_id   UUID NOT NULL REFERENCES pay_periods(id),
  business_id     UUID NOT NULL REFERENCES businesses(id),
  action          TEXT NOT NULL,
  reason          TEXT,
  previous_status TEXT,
  new_status      TEXT,
  performed_by    UUID NOT NULL REFERENCES users(id),
  performed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata        JSONB
);

CREATE INDEX IF NOT EXISTS idx_pal_pay_period ON payroll_audit_log(pay_period_id);

ALTER TABLE payroll_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY pal_admin ON payroll_audit_log
  FOR ALL USING (
    business_id IN (
      SELECT bm.business_id FROM business_members bm
      JOIN users u ON u.id = bm.user_id
      WHERE u.auth_user_id = auth.uid()
      AND bm.role IN ('OWNER', 'ADMIN')
      AND bm.status = 'ACTIVE'
    )
  );
