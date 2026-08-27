-- Migration 015b: Fix notifications RLS policies
--
-- Bug: target_user_id stores public.users.id, but RLS checked auth.uid()
-- which is auth.users.id — a different value.
-- Fix: match through users table, same pattern as attendance_records RLS.

-- Drop existing policies
DROP POLICY IF EXISTS notifications_admin_select ON notifications;
DROP POLICY IF EXISTS notifications_employee_select ON notifications;
DROP POLICY IF EXISTS notifications_update ON notifications;

-- Recreate with correct user ID matching
CREATE POLICY notifications_admin_select ON notifications
  FOR SELECT USING (
    business_id = current_user_business_id()
    AND (
      target_role = 'admin'
      OR target_user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    )
  );

CREATE POLICY notifications_employee_select ON notifications
  FOR SELECT USING (
    business_id = current_user_business_id()
    AND target_user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
  );

CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (
    business_id = current_user_business_id()
    AND (
      target_role = 'admin'
      OR target_user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    )
  )
  WITH CHECK (
    business_id = current_user_business_id()
  );
