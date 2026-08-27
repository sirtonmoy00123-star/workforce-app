-- Migration 015: Notifications table for attendance system Phase 13
-- Stores in-app notifications for both admin and employee users

-- Notification type enum
CREATE TYPE notification_type AS ENUM (
  'SHIFT_UPCOMING',
  'CHECKIN_REMINDER',
  'MISSED_CHECKIN',
  'ATTENDANCE_NEEDS_REVIEW',
  'ATTENDANCE_CORRECTION_RESULT',
  'LATE_ARRIVAL',
  'GPS_OUTSIDE_RADIUS',
  'WRONG_SITE',
  'EARLY_DEPARTURE',
  'LATE_DEPARTURE',
  'CORRECTION_REQUEST'
);

-- Notification target role
CREATE TYPE notification_target_role AS ENUM ('admin', 'employee');

CREATE TABLE notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES businesses(id),
  target_role   notification_target_role NOT NULL,
  target_user_id UUID,  -- NULL = all admins/employees in business, set = specific user
  employee_id   UUID REFERENCES employees(id),  -- the employee this notification is about
  shift_id      UUID REFERENCES shifts(id),
  attendance_id UUID REFERENCES attendance_records(id),
  type          notification_type NOT NULL,
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  action_url    TEXT,  -- link to review page
  is_read       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_notifications_business_target ON notifications(business_id, target_role, is_read);
CREATE INDEX idx_notifications_target_user ON notifications(target_user_id, is_read) WHERE target_user_id IS NOT NULL;
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX idx_notifications_shift ON notifications(shift_id) WHERE shift_id IS NOT NULL;

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Admins can see all notifications for their business targeted to admin role
CREATE POLICY notifications_admin_select ON notifications
  FOR SELECT USING (
    business_id = current_user_business_id()
    AND (
      target_role = 'admin'
      OR target_user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
    )
  );

-- Employees can only see their own notifications
CREATE POLICY notifications_employee_select ON notifications
  FOR SELECT USING (
    business_id = current_user_business_id()
    AND target_user_id = (SELECT id FROM public.users WHERE auth_user_id = auth.uid())
  );

-- Service role handles inserts (server-side only)
-- Updates (mark as read) allowed for own notifications
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
