/**
 * Audit Service — writes immutable audit events for all
 * domain actions (shifts, work sessions, timesheets, payments).
 *
 * Uses the admin client to bypass RLS for inserts.
 * Never logs passwords, auth tokens, or secrets.
 */

import { createAdminClient } from "@/lib/supabase/admin";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

export type AuditAction =
  | "SHIFT_CREATED"
  | "SHIFT_UPDATED"
  | "SHIFT_ACCEPTED"
  | "SHIFT_DECLINED"
  | "SHIFT_CANCELLED"
  | "SHIFT_DELETED"
  | "CHECKIN_CREATED"
  | "CHECKOUT_COMPLETED"
  | "ATTENDANCE_OVERRIDDEN"
  | "WORK_SESSION_STARTED"
  | "WORK_SESSION_FINISHED"
  | "TIMESHEET_GENERATED"
  | "TIMESHEET_ADJUSTED"
  | "TIMESHEET_APPROVED"
  | "TIMESHEET_CORRECTION_REQUESTED"
  | "TIMESHEET_CORRECTION_SUBMITTED"
  | "PAYMENT_CREATED"
  | "PAYMENT_MARKED_PAID"
  | "ROSTER_PUBLISHED"
  | "LEAVE_CREATED"
  | "LEAVE_APPROVED"
  | "LEAVE_REJECTED"
  | "LEAVE_CANCELLED"
  | "PAY_PERIOD_CREATED"
  | "PAY_PERIOD_LOCKED"
  | "PAY_PERIOD_REOPENED"
  | "PAY_PERIOD_PAID"
  | "PAYROLL_ADJUSTMENT_CREATED";

export type EntityType =
  | "shift"
  | "work_session"
  | "timesheet"
  | "payment"
  | "attendance"
  | "employee";

export interface AuditEventInput {
  businessId: string;
  actorUserId: string;
  actorRole: string;        // 'ADMIN', 'EMPLOYEE', 'OWNER', 'SYSTEM'
  entityType: EntityType;
  entityId: string;
  action: AuditAction;
  beforeJson?: Record<string, unknown> | null;
  afterJson?: Record<string, unknown> | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

// ────────────────────────────────────────────────────────────
// Write audit event
// ────────────────────────────────────────────────────────────

/**
 * Write an audit event. Fire-and-forget — failures are logged
 * but never block the calling operation.
 */
export async function writeAuditEvent(event: AuditEventInput): Promise<void> {
  try {
    const adminClient = createAdminClient();

    // Strip any sensitive fields that might have leaked into snapshots
    const sanitizedBefore = event.beforeJson ? sanitize(event.beforeJson) : null;
    const sanitizedAfter = event.afterJson ? sanitize(event.afterJson) : null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (adminClient as any)
      .from("audit_events")
      .insert({
        business_id: event.businessId,
        actor_user_id: event.actorUserId,
        actor_role: event.actorRole,
        entity_type: event.entityType,
        entity_id: event.entityId,
        action: event.action,
        before_json: sanitizedBefore,
        after_json: sanitizedAfter,
        reason: event.reason || null,
        metadata: event.metadata || null,
      });

    if (error) {
      console.error("[AuditService] Failed to write audit event:", error.message, {
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
      });
    }
  } catch (err) {
    // Never let audit failures break the main flow
    console.error("[AuditService] Unexpected error:", err);
  }
}

// ────────────────────────────────────────────────────────────
// Convenience builders
// ────────────────────────────────────────────────────────────

/** Build a shift audit event. */
export function shiftAudit(
  action: AuditAction,
  ctx: { businessId: string; userId: string; role: string },
  shiftId: string,
  opts?: { before?: Record<string, unknown>; after?: Record<string, unknown>; reason?: string }
): Promise<void> {
  return writeAuditEvent({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorRole: ctx.role,
    entityType: "shift",
    entityId: shiftId,
    action,
    beforeJson: opts?.before,
    afterJson: opts?.after,
    reason: opts?.reason,
  });
}

/** Build a work session audit event. */
export function workSessionAudit(
  action: AuditAction,
  ctx: { businessId: string; userId: string; role: string },
  workSessionId: string,
  opts?: { before?: Record<string, unknown>; after?: Record<string, unknown>; reason?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  return writeAuditEvent({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorRole: ctx.role,
    entityType: "work_session",
    entityId: workSessionId,
    action,
    beforeJson: opts?.before,
    afterJson: opts?.after,
    reason: opts?.reason,
    metadata: opts?.metadata,
  });
}

/** Build a timesheet audit event. */
export function timesheetAudit(
  action: AuditAction,
  ctx: { businessId: string; userId: string; role: string },
  timesheetId: string,
  opts?: { before?: Record<string, unknown>; after?: Record<string, unknown>; reason?: string }
): Promise<void> {
  return writeAuditEvent({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorRole: ctx.role,
    entityType: "timesheet",
    entityId: timesheetId,
    action,
    beforeJson: opts?.before,
    afterJson: opts?.after,
    reason: opts?.reason,
  });
}

// ────────────────────────────────────────────────────────────
// Sanitization — remove sensitive fields from snapshots
// ────────────────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  "password", "password_hash", "auth_token", "access_token",
  "refresh_token", "service_role_key", "qr_signing_secret",
  "secret", "api_key",
]);

function sanitize(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = value;
    }
  }
  return result;
}
