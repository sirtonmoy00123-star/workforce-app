-- ============================================================
-- Migration 013: Static QR Credentials for Attendance Check-In
--
-- Creates:
--   1. static_qr_credentials table (one active credential per location)
--   2. RLS policies (admin CRUD, employee SELECT for scan validation)
--   3. Indexes for token lookup and location lookup
--
-- The QR code contains an opaque random token. No business/location
-- IDs are exposed. On scan, the server looks up the token to find
-- the associated location and business.
--
-- Run in Supabase SQL Editor. All operations are idempotent.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- STEP 1: Create static_qr_credentials table
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.static_qr_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  location_id     UUID NOT NULL REFERENCES public.work_locations(id) ON DELETE CASCADE,

  -- Opaque random token encoded in the QR code
  -- 64-char hex string from 32 random bytes
  token           TEXT NOT NULL,

  -- ACTIVE = accepting scans, PAUSED = temporarily disabled, REVOKED = permanently invalidated
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE', 'PAUSED', 'REVOKED')),

  created_by      UUID REFERENCES public.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  regenerated_at  TIMESTAMPTZ,       -- set when a new credential replaces this one
  paused_at       TIMESTAMPTZ        -- set when status changes to PAUSED
);

-- Token must be globally unique for lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_static_qr_token
  ON public.static_qr_credentials (token);

-- Only one ACTIVE or PAUSED credential per location at a time
-- (REVOKED ones are kept for audit history)
CREATE UNIQUE INDEX IF NOT EXISTS idx_static_qr_active_location
  ON public.static_qr_credentials (location_id)
  WHERE status IN ('ACTIVE', 'PAUSED');

-- Lookup by business
CREATE INDEX IF NOT EXISTS idx_static_qr_business
  ON public.static_qr_credentials (business_id);

-- Lookup by location
CREATE INDEX IF NOT EXISTS idx_static_qr_location
  ON public.static_qr_credentials (location_id);


-- ────────────────────────────────────────────────────────────
-- STEP 2: RLS Policies
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.static_qr_credentials ENABLE ROW LEVEL SECURITY;

-- Admin: full CRUD within own business
CREATE POLICY "Static QR: admin select"
  ON public.static_qr_credentials FOR SELECT
  USING (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

CREATE POLICY "Static QR: admin insert"
  ON public.static_qr_credentials FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

CREATE POLICY "Static QR: admin update"
  ON public.static_qr_credentials FOR UPDATE
  USING (
    public.current_user_role() = 'admin'
    AND business_id = public.current_user_business_id()
  );

-- Employees need SELECT to validate scanned tokens during check-in
CREATE POLICY "Static QR: employee select"
  ON public.static_qr_credentials FOR SELECT
  USING (
    public.current_user_role() = 'employee'
    AND business_id = public.current_user_business_id()
  );


-- ============================================================
-- Done. Summary:
--   • static_qr_credentials — opaque tokens for location QR codes
--   • Partial unique index ensures one active/paused credential per location
--   • Token is globally unique for fast lookup on scan
--   • RLS: admin full CRUD, employee read-only (for scan validation)
-- ============================================================
