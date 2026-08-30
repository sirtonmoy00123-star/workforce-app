/**
 * Attention Queue Service — 8A+8B
 *
 * Aggregates actionable issues from existing data into a unified
 * operational queue with priority classification (CRITICAL / WARNING / INFO).
 *
 * Does NOT create duplicate source tables — reads from existing tables only.
 */

import { SupabaseClient } from "@supabase/supabase-js";

// ── Types ──────────────────────────────────────────────────

export type AttentionPriority = "CRITICAL" | "WARNING" | "INFO";

export type AttentionCategory =
  | "FAILED_CHECKIN"
  | "LATE_ARRIVAL"
  | "GPS_OUTSIDE_RANGE"
  | "MISSING_CHECKOUT"
  | "EARLY_DEPARTURE"
  | "ATTENDANCE_REVIEW"
  | "MISSING_TASK_PROOF"
  | "TASK_PROOF_CORRECTION"
  | "MISSING_ODOMETER"
  | "ODOMETER_MISMATCH"
  | "TIMESHEET_AWAITING_APPROVAL"
  | "TIMESHEET_CORRECTION"
  | "ROSTER_CONFLICT"
  | "UNFILLED_SHIFT"
  | "POSSIBLE_OVERTIME"
  | "PAYROLL_WAITING_REVIEW";

export interface AttentionItem {
  id: string;
  category: AttentionCategory;
  priority: AttentionPriority;
  title: string;
  description: string;
  employeeName?: string;
  employeeId?: string;
  entityId?: string;
  entityType?: string;
  actionUrl: string;
  createdAt: string;
}

// ── Priority map ───────────────────────────────────────────

const PRIORITY_MAP: Record<AttentionCategory, AttentionPriority> = {
  FAILED_CHECKIN: "CRITICAL",
  LATE_ARRIVAL: "WARNING",
  GPS_OUTSIDE_RANGE: "WARNING",
  MISSING_CHECKOUT: "CRITICAL",
  EARLY_DEPARTURE: "WARNING",
  ATTENDANCE_REVIEW: "WARNING",
  MISSING_TASK_PROOF: "WARNING",
  TASK_PROOF_CORRECTION: "INFO",
  MISSING_ODOMETER: "WARNING",
  ODOMETER_MISMATCH: "WARNING",
  TIMESHEET_AWAITING_APPROVAL: "INFO",
  TIMESHEET_CORRECTION: "WARNING",
  ROSTER_CONFLICT: "WARNING",
  UNFILLED_SHIFT: "WARNING",
  POSSIBLE_OVERTIME: "INFO",
  PAYROLL_WAITING_REVIEW: "INFO",
};

const PRIORITY_ORDER: Record<AttentionPriority, number> = {
  CRITICAL: 0,
  WARNING: 1,
  INFO: 2,
};

// ── Main function ──────────────────────────────────────────

export async function getAttentionItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: SupabaseClient | any,
  businessId: string,
  options?: { limit?: number; priority?: AttentionPriority; category?: AttentionCategory }
): Promise<AttentionItem[]> {
  const items: AttentionItem[] = [];

  // Run all queries in parallel
  const [
    attendanceExceptions,
    timesheetsToReview,
    timesheetCorrections,
    unfilledShifts,
    payrollReview,
    taskProofPending,
  ] = await Promise.all([
    getAttendanceExceptions(adminClient, businessId),
    getTimesheetsAwaitingApproval(adminClient, businessId),
    getTimesheetCorrections(adminClient, businessId),
    getUnfilledShifts(adminClient, businessId),
    getPayrollWaitingReview(adminClient, businessId),
    getTaskProofPending(adminClient, businessId),
  ]);

  items.push(...attendanceExceptions);
  items.push(...timesheetsToReview);
  items.push(...timesheetCorrections);
  items.push(...unfilledShifts);
  items.push(...payrollReview);
  items.push(...taskProofPending);

  // Filter by priority/category if requested
  let filtered = items;
  if (options?.priority) {
    filtered = filtered.filter((i) => i.priority === options.priority);
  }
  if (options?.category) {
    filtered = filtered.filter((i) => i.category === options.category);
  }

  // Sort: CRITICAL first, then WARNING, then INFO; within same priority, newest first
  filtered.sort((a, b) => {
    const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  // Apply limit
  const limit = options?.limit || 50;
  return filtered.slice(0, limit);
}

/** Summary counts by priority */
export async function getAttentionSummary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: SupabaseClient | any,
  businessId: string
): Promise<{ critical: number; warning: number; info: number; total: number }> {
  const items = await getAttentionItems(adminClient, businessId, { limit: 200 });
  const critical = items.filter((i) => i.priority === "CRITICAL").length;
  const warning = items.filter((i) => i.priority === "WARNING").length;
  const info = items.filter((i) => i.priority === "INFO").length;
  return { critical, warning, info, total: items.length };
}

// ── Individual collectors ──────────────────────────────────

async function getAttendanceExceptions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  businessId: string
): Promise<AttentionItem[]> {
  const { data } = await adminClient
    .from("attendance_exceptions")
    .select(`
      id, exception_type, difference_minutes, difference_metres,
      status, created_at, employee_id, shift_id,
      employees ( full_name )
    `)
    .eq("business_id", businessId)
    .eq("status", "PENDING")
    .order("created_at", { ascending: false })
    .limit(30);

  if (!data) return [];

  return data.map((exc: {
    id: string;
    exception_type: string;
    difference_minutes: number | null;
    difference_metres: number | null;
    created_at: string;
    employee_id: string;
    shift_id: string;
    employees: { full_name: string } | null;
  }) => {
    const category = mapExceptionCategory(exc.exception_type);
    const empName = exc.employees?.full_name || "Unknown";
    return {
      id: `exc-${exc.id}`,
      category,
      priority: PRIORITY_MAP[category],
      title: formatExceptionTitle(category, empName),
      description: formatExceptionDescription(exc),
      employeeName: empName,
      employeeId: exc.employee_id,
      entityId: exc.id,
      entityType: "attendance_exception",
      actionUrl: "/admin/attendance",
      createdAt: exc.created_at,
    };
  });
}

async function getTimesheetsAwaitingApproval(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  businessId: string
): Promise<AttentionItem[]> {
  const { data } = await adminClient
    .from("timesheets")
    .select("id, employee_id, actual_start, worked_minutes, total_amount, status, created_at, employees ( full_name )")
    .eq("business_id", businessId)
    .eq("status", "submitted")
    .order("created_at", { ascending: false })
    .limit(20);

  if (!data) return [];

  return data.map((ts: {
    id: string;
    employee_id: string;
    actual_start: string;
    worked_minutes: number;
    total_amount: number;
    created_at: string;
    employees: { full_name: string } | null;
  }) => {
    const empName = ts.employees?.full_name || "Unknown";
    const hours = Math.round(ts.worked_minutes / 60 * 10) / 10;
    return {
      id: `ts-${ts.id}`,
      category: "TIMESHEET_AWAITING_APPROVAL" as AttentionCategory,
      priority: "INFO" as AttentionPriority,
      title: `Timesheet: ${empName}`,
      description: `${hours}h · $${ts.total_amount.toFixed(2)} — awaiting approval`,
      employeeName: empName,
      employeeId: ts.employee_id,
      entityId: ts.id,
      entityType: "timesheet",
      actionUrl: "/admin/timesheets",
      createdAt: ts.created_at,
    };
  });
}

async function getTimesheetCorrections(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  businessId: string
): Promise<AttentionItem[]> {
  const { data } = await adminClient
    .from("timesheets")
    .select("id, employee_id, created_at, employees ( full_name )")
    .eq("business_id", businessId)
    .eq("status", "correction_submitted")
    .order("created_at", { ascending: false })
    .limit(10);

  if (!data) return [];

  return data.map((ts: {
    id: string;
    employee_id: string;
    created_at: string;
    employees: { full_name: string } | null;
  }) => ({
    id: `tsc-${ts.id}`,
    category: "TIMESHEET_CORRECTION" as AttentionCategory,
    priority: "WARNING" as AttentionPriority,
    title: `Correction: ${ts.employees?.full_name || "Unknown"}`,
    description: "Timesheet correction submitted — needs re-review",
    employeeName: ts.employees?.full_name || "Unknown",
    employeeId: ts.employee_id,
    entityId: ts.id,
    entityType: "timesheet",
    actionUrl: "/admin/timesheets",
    createdAt: ts.created_at,
  }));
}

async function getUnfilledShifts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  businessId: string
): Promise<AttentionItem[]> {
  const today = new Date().toISOString().split("T")[0];

  const { data } = await (adminClient as any)
    .from("shifts")
    .select("id, date, scheduled_start, scheduled_finish, location, created_at")
    .eq("business_id", businessId)
    .is("employee_id", null)
    .gte("date", today)
    .order("date", { ascending: true })
    .limit(15);

  if (!data) return [];

  return data.map((shift: {
    id: string;
    date: string;
    scheduled_start: string;
    scheduled_finish: string;
    location: string | null;
    created_at: string;
  }) => {
    const isToday = shift.date === today;
    const isTomorrow = (() => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return shift.date === tomorrow.toISOString().split("T")[0];
    })();

    return {
      id: `uf-${shift.id}`,
      category: "UNFILLED_SHIFT" as AttentionCategory,
      priority: (isToday ? "CRITICAL" : isTomorrow ? "WARNING" : "WARNING") as AttentionPriority,
      title: `Unfilled shift: ${isToday ? "Today" : isTomorrow ? "Tomorrow" : shift.date}`,
      description: `${new Date(shift.scheduled_start).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true })} – ${new Date(shift.scheduled_finish).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true })}${shift.location ? ` · ${shift.location}` : ""}`,
      entityId: shift.id,
      entityType: "shift",
      actionUrl: `/admin/roster`,
      createdAt: shift.created_at,
    };
  });
}

async function getPayrollWaitingReview(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  businessId: string
): Promise<AttentionItem[]> {
  const { data } = await (adminClient as any)
    .from("pay_periods")
    .select("id, period_start, period_end, status, total_payable, created_at")
    .eq("business_id", businessId)
    .in("status", ["DRAFT", "READY_FOR_REVIEW"])
    .order("period_start", { ascending: false })
    .limit(5);

  if (!data) return [];

  return data.map((pp: {
    id: string;
    period_start: string;
    period_end: string;
    status: string;
    total_payable: number | null;
    created_at: string;
  }) => ({
    id: `pp-${pp.id}`,
    category: "PAYROLL_WAITING_REVIEW" as AttentionCategory,
    priority: "INFO" as AttentionPriority,
    title: `Payroll: ${pp.period_start} – ${pp.period_end}`,
    description: `Status: ${pp.status}${pp.total_payable ? ` · $${pp.total_payable.toFixed(2)}` : ""}`,
    entityId: pp.id,
    entityType: "pay_period",
    actionUrl: "/admin/payments",
    createdAt: pp.created_at,
  }));
}

async function getTaskProofPending(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminClient: any,
  businessId: string
): Promise<AttentionItem[]> {
  const { data } = await adminClient
    .from("task_proof_submissions")
    .select("id, shift_id, employee_id, status, created_at, employees ( full_name )")
    .eq("business_id", businessId)
    .eq("status", "SUBMITTED")
    .order("created_at", { ascending: false })
    .limit(10);

  if (!data) return [];

  return data.map((tp: {
    id: string;
    shift_id: string;
    employee_id: string;
    created_at: string;
    employees: { full_name: string } | null;
  }) => ({
    id: `tp-${tp.id}`,
    category: "MISSING_TASK_PROOF" as AttentionCategory,
    priority: "WARNING" as AttentionPriority,
    title: `Task proof: ${tp.employees?.full_name || "Unknown"}`,
    description: "Task proof submitted — awaiting review",
    employeeName: tp.employees?.full_name || "Unknown",
    employeeId: tp.employee_id,
    entityId: tp.id,
    entityType: "task_proof",
    actionUrl: "/admin/task-proof-templates",
    createdAt: tp.created_at,
  }));
}

// ── Helpers ────────────────────────────────────────────────

function mapExceptionCategory(exceptionType: string): AttentionCategory {
  switch (exceptionType) {
    case "LATE_CHECKIN":
    case "LATE_ARRIVAL":
      return "LATE_ARRIVAL";
    case "EARLY_CHECKOUT":
    case "EARLY_DEPARTURE":
      return "EARLY_DEPARTURE";
    case "GPS_DEVIATION":
    case "GPS_OUTSIDE_RANGE":
      return "GPS_OUTSIDE_RANGE";
    case "MISSED_CHECKIN":
    case "FAILED_CHECKIN":
      return "FAILED_CHECKIN";
    case "MISSED_CHECKOUT":
    case "MISSING_CHECKOUT":
      return "MISSING_CHECKOUT";
    case "ODOMETER_MISMATCH":
      return "ODOMETER_MISMATCH";
    default:
      return "ATTENDANCE_REVIEW";
  }
}

function formatExceptionTitle(category: AttentionCategory, empName: string): string {
  switch (category) {
    case "FAILED_CHECKIN": return `Failed check-in: ${empName}`;
    case "LATE_ARRIVAL": return `Late arrival: ${empName}`;
    case "GPS_OUTSIDE_RANGE": return `GPS deviation: ${empName}`;
    case "MISSING_CHECKOUT": return `Missing checkout: ${empName}`;
    case "EARLY_DEPARTURE": return `Early departure: ${empName}`;
    case "ODOMETER_MISMATCH": return `Odometer mismatch: ${empName}`;
    default: return `Attendance issue: ${empName}`;
  }
}

function formatExceptionDescription(exc: {
  exception_type: string;
  difference_minutes: number | null;
  difference_metres: number | null;
}): string {
  if (exc.difference_minutes && exc.difference_minutes > 0) {
    return `${exc.difference_minutes} minutes late`;
  }
  if (exc.difference_metres && exc.difference_metres > 0) {
    return `${exc.difference_metres}m from expected location`;
  }
  return exc.exception_type.replace(/_/g, " ").toLowerCase();
}
