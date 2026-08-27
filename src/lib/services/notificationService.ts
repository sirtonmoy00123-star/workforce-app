// Notification service — creates in-app notifications for attendance events
// Only triggers for meaningful exceptions, not normal check-ins (spec §50)

import { createAdminClient } from "@/lib/supabase/admin";

interface CreateNotificationParams {
  businessId: string;
  targetRole: "admin" | "employee";
  targetUserId?: string;    // specific user, or null for all admins
  employeeId?: string;      // the employee this is about
  shiftId?: string;
  attendanceId?: string;
  type: string;
  title: string;
  message: string;
  actionUrl?: string;
}

export async function createNotification(params: CreateNotificationParams): Promise<void> {
  const adminClient = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient as any).from("notifications").insert({
    business_id: params.businessId,
    target_role: params.targetRole,
    target_user_id: params.targetUserId || null,
    employee_id: params.employeeId || null,
    shift_id: params.shiftId || null,
    attendance_id: params.attendanceId || null,
    type: params.type,
    title: params.title,
    message: params.message,
    action_url: params.actionUrl || null,
  });
}

// Create admin notification for an attendance exception
export async function notifyAdminException(params: {
  businessId: string;
  employeeId: string;
  employeeName: string;
  shiftId: string;
  attendanceId: string;
  exceptionType: string;
  minutes?: number;
}): Promise<void> {
  const { businessId, employeeName, exceptionType, minutes } = params;

  let title = "";
  let message = "";

  switch (exceptionType) {
    case "LATE_ARRIVAL":
      title = `⚠ ${employeeName} — Late Arrival`;
      message = `${minutes || 0} min late`;
      break;
    case "EARLY_DEPARTURE":
      title = `⚠ ${employeeName} — Early Departure`;
      message = `Left ${minutes || 0} min early`;
      break;
    case "LATE_DEPARTURE":
      title = `⚠ ${employeeName} — Late Finish`;
      message = `${minutes || 0} min overtime`;
      break;
    case "GPS_OUT_OF_RANGE":
      title = `⚠ ${employeeName} — GPS Outside Radius`;
      message = "GPS location outside allowed site radius";
      break;
    case "WRONG_SITE":
      title = `⚠ ${employeeName} — Wrong Site`;
      message = "Checked in at wrong location";
      break;
    case "MISSED_CHECKIN":
      title = `⚠ ${employeeName} — Missed Check-In`;
      message = "No verified attendance after grace period";
      break;
    default:
      title = `⚠ ${employeeName} — Attendance Exception`;
      message = exceptionType.replace(/_/g, " ");
  }

  await createNotification({
    businessId,
    targetRole: "admin",
    employeeId: params.employeeId,
    shiftId: params.shiftId,
    attendanceId: params.attendanceId,
    type: mapExceptionToNotificationType(exceptionType),
    title,
    message,
    actionUrl: "/admin/attendance",
  });
}

// Notify employee about their attendance status
export async function notifyEmployee(params: {
  businessId: string;
  targetUserId: string;   // the auth user id for the employee
  employeeId: string;
  shiftId: string;
  attendanceId?: string;
  type: string;
  title: string;
  message: string;
}): Promise<void> {
  await createNotification({
    businessId: params.businessId,
    targetRole: "employee",
    targetUserId: params.targetUserId,
    employeeId: params.employeeId,
    shiftId: params.shiftId,
    attendanceId: params.attendanceId,
    type: params.type,
    title: params.title,
    message: params.message,
    actionUrl: "/employee/attendance",
  });
}

function mapExceptionToNotificationType(exceptionType: string): string {
  switch (exceptionType) {
    case "LATE_ARRIVAL": return "LATE_ARRIVAL";
    case "EARLY_DEPARTURE": return "EARLY_DEPARTURE";
    case "LATE_DEPARTURE": return "LATE_DEPARTURE";
    case "GPS_OUT_OF_RANGE": return "GPS_OUTSIDE_RADIUS";
    case "WRONG_SITE": return "WRONG_SITE";
    case "MISSED_CHECKIN": return "MISSED_CHECKIN";
    default: return "ATTENDANCE_NEEDS_REVIEW";
  }
}
