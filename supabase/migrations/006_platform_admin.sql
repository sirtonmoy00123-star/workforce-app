-- Migration 006: Platform admin support
-- Adds is_platform_admin flag to users table
-- PLATFORM_ADMIN is a platform-level role, NOT stored in business_members (per CLAUDE-SAAS-RULES)

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

-- Set the OWNER of the earliest business as platform admin
UPDATE public.users
SET is_platform_admin = true
WHERE id = (
  SELECT user_id FROM public.business_members
  WHERE role = 'OWNER'
  ORDER BY created_at ASC
  LIMIT 1
);
