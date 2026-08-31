// ────────────────────────────────────────────────────────────
// Notification Service — Phase 9 upgrade
// Creates structured in-app notifications with deduplication
// ────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";

// ── Notification Types (matches DB enum) ──────────────────

export type NotificationType =
  | "SHIFT_UPCOMING"
  | "CHECKIN_REMINDER"
  | "MISSED_CHECKIN"
  | "ATTENDANCE_NEEDS_REVIEW"
  | "ATTENDANCE_CORRECTION_RESULT"
  | "LATE_ARRIVAL"
  | "GPS_OUTSIDE_RADIUS"
  | "WRONG_SITE"
  | "EARLY_DEPARTURE"
  | "LATE_DEPARTURE"
  | "CORRECTION_REQUEST"
  // Phase 9 new types
  | "SHIFT_ASSIGNED"
  | "SHIFT_UPDATED"
  | "SHIFT_CANCELLED"
  | "OPEN_SHIFT_AVAILABLE"
  | "TIMESHEET_APPROVED"
  | "TIMESHEET_CORRECTION"
  | "PAYMENT_PROCESSED"
  | "LEAVE_APPROVED"
  | "LEAVE_REJECTED"
  | "SHIFT_REMINDER"
  | "MISSING_CHECKOUT"
  | "OFFER_RECEIVED"
  | "OFFER_EXPIRED"
  | "OFFER_ACCEPTED";

// ── Interfaces ────────────────────────────────────────────

interface CreateNotificationParams {
  businessId: string;
  targetRole: "admin" | "employee";
  targetUserId?: string;    // specific user, or null for all admins
  employeeId?: string;      // the employee this is about
  shiftId?: string;
  attendanceId?: string;
  type: NotificationType;
  title: string;
  message: string;
  actionUrl?: string;
}

export interface BusinessNotificationSettings {
  shiftReminderMinutes: number[];
  missingCheckinEmployeeMinutes: number;
  missingCheckinAdminMinutes: number;
  missingCheckoutEmployeeMinutes: number;
  missingCheckoutAdminMinutes: number;
  autoMarkAbsent: boolean;
  defaultOfferExpiryHours: number;
}

const DEFAULT_SETTINGS: BusinessNotificationSettings = {
  shiftReminderMinutes: [1440, 120],
  missingCheckinEmployeeMinutes: 5,
  missingCheckinAdminMinutes: 15,
  missingCheckoutEmployeeMinutes: 15,
  missingCheckoutAdminMinutes: 30,
  autoMarkAbsent: false,
  defaultOfferExpiryHours: 24,
};

// ── Core Functions ────────────────────────────────────────

/**
 * Create a notification. Silently skips duplicates (dedup index).
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  const adminClient = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (adminClient as any).from("notifications").insert({
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
    channel: "in_app",
    delivery_status: "DELIVERED",
    delivered_at: new Date().toISOString(),
  });

  // Silently ignore duplicate key errors (dedup index)
  if (error && !error.message?.includes("duplicate key")) {
    console.error("Failed to create notification:", error.message);
  }
}

/**
 * Send notification to a specific employee.
 */
export async function notifyEmployee(params: {
  businessId: string;
  targetUserId: string;
  employeeId: string;
  shiftId?: string;
  attendanceId?: string;
  type: NotificationType;
  title: string;
  message: string;
  actionUrl?: string;
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
    actionUrl: params.actionUrl || "/employee/home",
  });
}

/**
 * Send notification to all admins in a business.
 */
export async function notifyAdmins(params: {
  businessId: string;
  employeeId?: string;
  shiftId?: string;
  attendanceId?: string;
  type: NotificationType;
  title: string;
  message: string;
  actionUrl?: string;
}): Promise<void> {
  await createNotification({
    businessId: params.businessId,
    targetRole: "admin",
    employeeId: params.employeeId,
    shiftId: params.shiftId,
    attendanceId: params.attendanceId,
    type: params.type,
    title: params.title,
    message: params.message,
    actionUrl: params.actionUrl || "/admin/dashboard",
  });
}

// ── Admin Exception Notifications (backward compatible) ───

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
    type: mapExceptionToType(exceptionType),
    title,
    message,
    actionUrl: "/admin/attendance",
  });
}

function mapExceptionToType(exceptionType: string): NotificationType {
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

// ── Shift Lifecycle Notifications ─────────────────────────

/** Notify employee when a shift is assigned to them */
export async function notifyShiftAssigned(params: {
  businessId: string;
  targetUserId: string;
  employeeId: string;
  shiftId: string;
  shiftDate: string;
  startTime: string;
  location?: string;
}): Promise<void> {
  const dateStr = new Date(params.shiftDate + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "short", day: "numeric", month: "short",
  });
  await notifyEmployee({
    businessId: params.businessId,
    targetUserId: params.targetUserId,
    employeeId: params.employeeId,
    shiftId: params.shiftId,
    type: "SHIFT_ASSIGNED",
    title: "📅 New Shift Assigned",
    message: `${dateStr}${params.location ? ` at ${params.location}` : ""}`,
    actionUrl: `/employee/shifts/${params.shiftId}`,
  });
}

/** Notify employee when their shift is updated */
export async function notifyShiftUpdated(params: {
  businessId: string;
  targetUserId: string;
  employeeId: string;
  shiftId: string;
  changeDescription: string;
}): Promise<void> {
  await notifyEmployee({
    businessId: params.businessId,
    targetUserId: params.targetUserId,
    employeeId: params.employeeId,
    shiftId: params.shiftId,
    type: "SHIFT_UPDATED",
    title: "✏️ Shift Updated",
    message: params.changeDescription,
    actionUrl: `/employee/shifts/${params.shiftId}`,
  });
}

/** Notify employee when their shift is cancelled */
export async function notifyShiftCancelled(params: {
  businessId: string;
  targetUserId: string;
  employeeId: string;
  shiftId: string;
  shiftDate: string;
}): Promise<void> {
  const dateStr = new Date(params.shiftDate + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "short", day: "numeric", month: "short",
  });
  await notifyEmployee({
    businessId: params.businessId,
    targetUserId: params.targetUserId,
    employeeId: params.employeeId,
    shiftId: params.shiftId,
    type: "SHIFT_CANCELLED",
    title: "❌ Shift Cancelled",
    message: `Your shift on ${dateStr} has been cancelled`,
    actionUrl: "/employee/shifts",
  });
}

/** Notify employee about a shift reminder */
export async function notifyShiftReminder(params: {
  businessId: string;
  targetUserId: string;
  employeeId: string;
  shiftId: string;
  shiftDate: string;
  startTime: string;
  minutesBefore: number;
  location?: string;
}): Promise<void> {
  const timeLabel = params.minutesBefore >= 1440
    ? `${Math.floor(params.minutesBefore / 1440)} day${Math.floor(params.minutesBefore / 1440) > 1 ? "s" : ""}`
    : params.minutesBefore >= 60
      ? `${Math.floor(params.minutesBefore / 60)} hour${Math.floor(params.minutesBefore / 60) > 1 ? "s" : ""}`
      : `${params.minutesBefore} min`;

  await notifyEmployee({
    businessId: params.businessId,
    targetUserId: params.targetUserId,
    employeeId: params.employeeId,
    shiftId: params.shiftId,
    type: "SHIFT_REMINDER",
    title: `⏰ Shift in ${timeLabel}`,
    message: `${params.location ? `At ${params.location}` : "Your shift starts soon"}`,
    actionUrl: `/employee/shifts/${params.shiftId}`,
  });
}

/** Notify employee about missing checkout */
export async function notifyMissingCheckout(params: {
  businessId: string;
  targetUserId: string;
  employeeId: string;
  employeeName: string;
  shiftId: string;
}): Promise<void> {
  // Notify employee
  await notifyEmployee({
    businessId: params.businessId,
    targetUserId: params.targetUserId,
    employeeId: params.employeeId,
    shiftId: params.shiftId,
    type: "MISSING_CHECKOUT",
    title: "⚠️ Missing Checkout",
    message: "Your shift has ended but you haven't checked out",
    actionUrl: `/employee/finish-shift/${params.shiftId}`,
  });

  // Notify admins
  await notifyAdmins({
    businessId: params.businessId,
    employeeId: params.employeeId,
    shiftId: params.shiftId,
    type: "MISSING_CHECKOUT",
    title: `⚠ ${params.employeeName} — Missing Checkout`,
    message: "Shift ended without checkout",
    actionUrl: "/admin/attendance",
  });
}

// ── Timesheet & Payment Notifications ─────────────────────

export async function notifyTimesheetApproved(params: {
  businessId: string;
  targetUserId: string;
  employeeId: string;
  shiftId?: string;
  timesheetId: string;
  amount: number;
}): Promise<void> {
  await notifyEmployee({
    businessId: params.businessId,
    targetUserId: params.targetUserId,
    employeeId: params.employeeId,
    shiftId: params.shiftId,
    type: "TIMESHEET_APPROVED",
    title: "✅ Timesheet Approved",
    message: `$${params.amount.toFixed(2)} approved for payment`,
    actionUrl: `/employee/timesheets/${params.timesheetId}`,
  });
}

export async function notifyTimesheetCorrection(params: {
  businessId: string;
  targetUserId: string;
  employeeId: string;
  shiftId?: string;
  timesheetId: string;
  reason: string;
}): Promise<void> {
  await notifyEmployee({
    businessId: params.businessId,
    targetUserId: params.targetUserId,
    employeeId: params.employeeId,
    shiftId: params.shiftId,
    type: "TIMESHEET_CORRECTION",
    title: "✏️ Timesheet Needs Correction",
    message: params.reason,
    actionUrl: `/employee/timesheets/${params.timesheetId}`,
  });
}

export async function notifyPaymentProcessed(params: {
  businessId: string;
  targetUserId: string;
  employeeId: string;
  amount: number;
  period: string;
}): Promise<void> {
  await notifyEmployee({
    businessId: params.businessId,
    targetUserId: params.targetUserId,
    employeeId: params.employeeId,
    type: "PAYMENT_PROCESSED",
    title: "💰 Payment Processed",
    message: `$${params.amount.toFixed(2)} for ${params.period}`,
    actionUrl: "/employee/payments",
  });
}

// ── Open Shift & Offer Notifications ──────────────────────

export async function notifyOfferReceived(params: {
  businessId: string;
  targetUserId: string;
  employeeId: string;
  shiftDate: string;
  location?: string;
  expiresAt?: string;
}): Promise<void> {
  const dateStr = new Date(params.shiftDate + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "short", day: "numeric", month: "short",
  });
  const expiryNote = params.expiresAt
    ? ` — expires ${new Date(params.expiresAt).toLocaleString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true })}`
    : "";

  await notifyEmployee({
    businessId: params.businessId,
    targetUserId: params.targetUserId,
    employeeId: params.employeeId,
    type: "OFFER_RECEIVED",
    title: "🎪 Open Shift Available",
    message: `${dateStr}${params.location ? ` at ${params.location}` : ""}${expiryNote}`,
    actionUrl: "/employee/offers",
  });
}

export async function notifyOfferExpired(params: {
  businessId: string;
  targetUserId: string;
  employeeId: string;
}): Promise<void> {
  await notifyEmployee({
    businessId: params.businessId,
    targetUserId: params.targetUserId,
    employeeId: params.employeeId,
    type: "OFFER_EXPIRED",
    title: "⏰ Offer Expired",
    message: "A shift offer has expired",
    actionUrl: "/employee/offers",
  });
}

export async function notifyOfferAccepted(params: {
  businessId: string;
  employeeName: string;
  employeeId: string;
  shiftDate: string;
  role: string;
}): Promise<void> {
  const dateStr = new Date(params.shiftDate + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "short", day: "numeric", month: "short",
  });
  await notifyAdmins({
    businessId: params.businessId,
    employeeId: params.employeeId,
    type: "OFFER_ACCEPTED",
    title: `✅ ${params.employeeName} Accepted Shift`,
    message: `${params.role} on ${dateStr}`,
    actionUrl: "/admin/roster",
  });
}

// ── Leave Notifications ───────────────────────────────────

export async function notifyLeaveApproved(params: {
  businessId: string;
  targetUserId: string;
  employeeId: string;
  startDate: string;
  endDate: string;
}): Promise<void> {
  await notifyEmployee({
    businessId: params.businessId,
    targetUserId: params.targetUserId,
    employeeId: params.employeeId,
    type: "LEAVE_APPROVED",
    title: "✅ Leave Approved",
    message: `${params.startDate} to ${params.endDate}`,
    actionUrl: "/employee/shifts",
  });
}

export async function notifyLeaveRejected(params: {
  businessId: string;
  targetUserId: string;
  employeeId: string;
  reason?: string;
}): Promise<void> {
  await notifyEmployee({
    businessId: params.businessId,
    targetUserId: params.targetUserId,
    employeeId: params.employeeId,
    type: "LEAVE_REJECTED",
    title: "❌ Leave Declined",
    message: params.reason || "Your leave request was declined",
    actionUrl: "/employee/shifts",
  });
}

// ── Business Settings ─────────────────────────────────────

/**
 * Get notification settings for a business (creates defaults if none exist).
 */
export async function getBusinessNotificationSettings(
  businessId: string
): Promise<BusinessNotificationSettings> {
  const adminClient = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (adminClient as any)
    .from("business_notification_settings")
    .select("*")
    .eq("business_id", businessId)
    .single();

  if (!data) {
    // Create defaults
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminClient as any)
      .from("business_notification_settings")
      .insert({ business_id: businessId });

    return DEFAULT_SETTINGS;
  }

  return {
    shiftReminderMinutes: data.shift_reminder_minutes || DEFAULT_SETTINGS.shiftReminderMinutes,
    missingCheckinEmployeeMinutes: data.missing_checkin_employee_minutes ?? DEFAULT_SETTINGS.missingCheckinEmployeeMinutes,
    missingCheckinAdminMinutes: data.missing_checkin_admin_minutes ?? DEFAULT_SETTINGS.missingCheckinAdminMinutes,
    missingCheckoutEmployeeMinutes: data.missing_checkout_employee_minutes ?? DEFAULT_SETTINGS.missingCheckoutEmployeeMinutes,
    missingCheckoutAdminMinutes: data.missing_checkout_admin_minutes ?? DEFAULT_SETTINGS.missingCheckoutAdminMinutes,
    autoMarkAbsent: data.auto_mark_absent ?? DEFAULT_SETTINGS.autoMarkAbsent,
    defaultOfferExpiryHours: data.default_offer_expiry_hours ?? DEFAULT_SETTINGS.defaultOfferExpiryHours,
  };
}

/**
 * Update notification settings for a business.
 */
export async function updateBusinessNotificationSettings(
  businessId: string,
  updates: Partial<BusinessNotificationSettings>
): Promise<void> {
  const adminClient = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbUpdates: Record<string, any> = {};
  if (updates.shiftReminderMinutes !== undefined) dbUpdates.shift_reminder_minutes = updates.shiftReminderMinutes;
  if (updates.missingCheckinEmployeeMinutes !== undefined) dbUpdates.missing_checkin_employee_minutes = updates.missingCheckinEmployeeMinutes;
  if (updates.missingCheckinAdminMinutes !== undefined) dbUpdates.missing_checkin_admin_minutes = updates.missingCheckinAdminMinutes;
  if (updates.missingCheckoutEmployeeMinutes !== undefined) dbUpdates.missing_checkout_employee_minutes = updates.missingCheckoutEmployeeMinutes;
  if (updates.missingCheckoutAdminMinutes !== undefined) dbUpdates.missing_checkout_admin_minutes = updates.missingCheckoutAdminMinutes;
  if (updates.autoMarkAbsent !== undefined) dbUpdates.auto_mark_absent = updates.autoMarkAbsent;
  if (updates.defaultOfferExpiryHours !== undefined) dbUpdates.default_offer_expiry_hours = updates.defaultOfferExpiryHours;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (adminClient as any)
    .from("business_notification_settings")
    .upsert({
      business_id: businessId,
      ...dbUpdates,
    }, { onConflict: "business_id" });

  if (error) {
    console.error("Failed to update notification settings:", error.message);
  }
}
