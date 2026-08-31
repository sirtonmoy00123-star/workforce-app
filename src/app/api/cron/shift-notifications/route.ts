// POST /api/cron/shift-notifications
// Processes: shift reminders (9C), missing check-ins (9D), missing checkouts (9E), expired offers (9G)
// Should be called every 5 minutes via cron (Vercel cron or external)
//
// Security: validates CRON_SECRET header or admin auth

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  notifyShiftReminder,
  notifyMissingCheckout,
  notifyEmployee,
  notifyAdmins,
  getBusinessNotificationSettings,
} from "@/lib/services/notificationService";

export async function POST(request: NextRequest) {
  // Auth: CRON_SECRET header required in production
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  // In production, CRON_SECRET must be set and must match
  if (!cronSecret) {
    // No secret configured — block in production, allow in dev
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
    }
  } else if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();
  const results = {
    reminders: 0,
    missingCheckins: 0,
    missingCheckouts: 0,
    expiredOffers: 0,
    errors: [] as string[],
  };

  try {
    // Get all active businesses
    const { data: businesses } = await adminClient
      .from("businesses")
      .select("id, timezone")
      .eq("status", "ACTIVE");

    for (const business of businesses || []) {
      try {
        const settings = await getBusinessNotificationSettings(business.id);
        const now = new Date();

        // ── 9C: Shift Reminders ──────────────────────────
        for (const reminderMinutes of settings.shiftReminderMinutes) {
          const windowStart = new Date(now.getTime() + (reminderMinutes - 2.5) * 60 * 1000);
          const windowEnd = new Date(now.getTime() + (reminderMinutes + 2.5) * 60 * 1000);

          const { data: upcomingShifts } = await adminClient
            .from("shifts")
            .select("id, employee_id, date, scheduled_start, location, status")
            .eq("business_id", business.id)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .in("status", ["pending", "accepted"] as any)
            .gte("scheduled_start", windowStart.toISOString())
            .lte("scheduled_start", windowEnd.toISOString());

          for (const shift of upcomingShifts || []) {
            // Get user ID for the employee
            const { data: emp } = await adminClient
              .from("employees")
              .select("id, user_id")
              .eq("id", shift.employee_id)
              .single();

            if (emp?.user_id) {
              await notifyShiftReminder({
                businessId: business.id,
                targetUserId: emp.user_id,
                employeeId: shift.employee_id,
                shiftId: shift.id,
                shiftDate: shift.date,
                startTime: shift.scheduled_start,
                minutesBefore: reminderMinutes,
                location: shift.location ?? undefined,
              });
              results.reminders++;
            }
          }
        }

        // ── 9D: Missing Check-In ─────────────────────────
        const checkinThreshold = new Date(
          now.getTime() - settings.missingCheckinAdminMinutes * 60 * 1000
        );

        const { data: missedCheckins } = await adminClient
          .from("shifts")
          .select("id, employee_id, date, scheduled_start, location")
          .eq("business_id", business.id)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .in("status", ["pending", "accepted"] as any)
          .lte("scheduled_start", checkinThreshold.toISOString())
          .gte("scheduled_start", new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString()); // within 4 hours

        for (const shift of missedCheckins || []) {
          // Check if shift has a work session (meaning they started)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: ws } = await (adminClient as any)
            .from("work_sessions")
            .select("id")
            .eq("shift_id", shift.id)
            .limit(1);

          if (!ws?.length) {
            const { data: emp } = await adminClient
              .from("employees")
              .select("id, user_id, full_name")
              .eq("id", shift.employee_id)
              .single();

            if (emp) {
              // Notify admin
              await notifyAdmins({
                businessId: business.id,
                employeeId: shift.employee_id,
                shiftId: shift.id,
                type: "MISSED_CHECKIN",
                title: `⚠ ${emp.full_name} — No Check-In`,
                message: `Shift started ${settings.missingCheckinAdminMinutes}+ min ago, no check-in`,
                actionUrl: "/admin/attendance",
              });

              // Notify employee
              if (emp.user_id) {
                await notifyEmployee({
                  businessId: business.id,
                  targetUserId: emp.user_id,
                  employeeId: shift.employee_id,
                  shiftId: shift.id,
                  type: "CHECKIN_REMINDER",
                  title: "⏰ Check-In Reminder",
                  message: "Your shift has started — please check in",
                  actionUrl: `/employee/checkin/${shift.id}`,
                });
              }
              results.missingCheckins++;
            }
          }
        }

        // ── 9E: Missing Checkout ─────────────────────────
        // Shifts stay "accepted" while a work_session is "working" —
        // there is no "in_progress" shift status. So we find accepted
        // shifts whose scheduled_finish has passed AND that have an
        // active work session (status = "working").
        const checkoutThreshold = new Date(
          now.getTime() - settings.missingCheckoutAdminMinutes * 60 * 1000
        );

        const { data: overdueShifts } = await adminClient
          .from("shifts")
          .select("id, employee_id, date, scheduled_finish")
          .eq("business_id", business.id)
          .eq("status", "accepted")
          .lte("scheduled_finish", checkoutThreshold.toISOString())
          .gte("scheduled_finish", new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString());

        // Filter to only those with an active work session
        const missedCheckouts: typeof overdueShifts = [];
        for (const shift of overdueShifts || []) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: ws } = await (adminClient as any)
            .from("work_sessions")
            .select("id")
            .eq("shift_id", shift.id)
            .eq("status", "working")
            .limit(1);
          if (ws?.length) {
            missedCheckouts.push(shift);
          }
        }

        for (const shift of missedCheckouts || []) {
          const { data: emp } = await adminClient
            .from("employees")
            .select("id, user_id, full_name")
            .eq("id", shift.employee_id)
            .single();

          if (emp) {
            await notifyMissingCheckout({
              businessId: business.id,
              targetUserId: emp.user_id || "",
              employeeId: shift.employee_id,
              employeeName: emp.full_name,
              shiftId: shift.id,
            });
            results.missingCheckouts++;
          }
        }
      } catch (bizErr) {
        results.errors.push(`Business ${business.id}: ${String(bizErr)}`);
      }
    }

    // ── 9G: Expire Offers (global, not per-business) ───
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: expireResult } = await (adminClient as any).rpc("expire_pending_offers");
    results.expiredOffers = expireResult || 0;

  } catch (err) {
    return NextResponse.json(
      { error: "Cron failed", details: String(err) },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    processed: results,
    timestamp: new Date().toISOString(),
  });
}

// Also allow GET for manual testing
export async function GET(request: NextRequest) {
  return POST(request);
}
