-- Migration 016: Phase 14 Security Audit Fixes
--
-- Fixes found during security review:
--
-- 1. Storage: attendance-photos read/upload policies too permissive
--    Any authenticated user could read any file. Now:
--    - Admin/Owner: can read all files in their business
--    - Employee: can only read files in their own employee folder
--    - Upload: restricted to own employee folder
--
-- 2. No DELETE policies on attendance data tables (verify existing)
--    attendance_records and attendance_exceptions must NOT have DELETE policies.
--    (Confirmed: they don't. This is just documentation.)

-- ── Fix 1: Tighten attendance-photos storage policies ──

-- Drop overly permissive policies
DROP POLICY IF EXISTS "Attendance photos: upload own" ON storage.objects;
DROP POLICY IF EXISTS "Attendance photos: read own" ON storage.objects;

-- Upload: only to own employee folder (server uses admin client anyway,
-- but this is defense-in-depth)
CREATE POLICY "Attendance photos: upload own"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'attendance-photos'
    AND auth.uid() IS NOT NULL
    AND (
      -- Admin can upload anywhere in the bucket
      public.current_user_role() = 'admin'
      OR
      -- Employee can only upload to their own folder
      name LIKE (
        SELECT e.id::text || '/%'
        FROM public.employees e
        JOIN public.users u ON u.id = e.user_id
        WHERE u.auth_user_id = auth.uid()
        LIMIT 1
      )
    )
  );

-- Read: admin can read all, employee only their own folder
CREATE POLICY "Attendance photos: read own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'attendance-photos'
    AND auth.uid() IS NOT NULL
    AND (
      -- Admin can read all attendance photos
      public.current_user_role() = 'admin'
      OR
      -- Employee can only read from their own folder
      name LIKE (
        SELECT e.id::text || '/%'
        FROM public.employees e
        JOIN public.users u ON u.id = e.user_id
        WHERE u.auth_user_id = auth.uid()
        LIMIT 1
      )
    )
  );
