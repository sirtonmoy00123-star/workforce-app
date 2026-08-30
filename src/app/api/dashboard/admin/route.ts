// GET /api/dashboard/admin — stats for admin dashboard
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";
import { utcToLocal, getBusinessTimezone } from "@/lib/calculations/timezone";

export async function GET() {
  try {
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();

    // ── Wave 1: Run timezone fetch + non-date queries in parallel ──
    const [
      tz,
      { data: employees },
      { count: pendingShifts },
      { count: siteIssues },
      { count: proofCount, error: proofErr },
      { count: attendanceReview },
      { data: actionItems },
      { count: unreadNotifications },
    ] = await Promise.all([
      // Timezone (needed for today's date)
      getBusinessTimezone(ctx.businessId),
      // Employees
      adminClient
        .from("employees")
        .select("id, employment_status")
        .eq("business_id", ctx.businessId),
      // Pending shifts
      adminClient
        .from("shifts")
        .select("*", { count: "exact", head: true })
        .eq("business_id", ctx.businessId)
        .eq("status", "pending"),
      // Site issues
      adminClient
        .from("attendance_exceptions")
        .select("*", { count: "exact", head: true })
        .eq("business_id", ctx.businessId)
        .eq("status", "PENDING"),
      // Task proof pending
      adminClient
        .from("task_proof_submissions")
        .select("*", { count: "exact", head: true })
        .eq("business_id", ctx.businessId)
        .eq("status", "SUBMITTED"),
      // Attendance needing review
      adminClient
        .from("attendance_records")
        .select("*", { count: "exact", head: true })
        .eq("business_id", ctx.businessId)
        .eq("requires_review", true)
        .eq("verification_status", "NEEDS_REVIEW"),
      // Action required items
      adminClient
        .from("attendance_exceptions")
        .select(`
          id,
          attendance_record_id,
          employee_id,
          shift_id,
          exception_type,
          difference_minutes,
          difference_metres,
          status,
          created_at,
          employees ( full_name, employee_number )
        `)
        .eq("business_id", ctx.businessId)
        .eq("status", "PENDING")
        .order("created_at", { ascending: false })
        .limit(10),
      // Unread notifications
      adminClient
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("business_id", ctx.businessId)
        .eq("target_role", "admin")
        .eq("is_read", false),
    ]);

    // Now compute today's date with the timezone we fetched
    const todayStr = utcToLocal(new Date().toISOString(), tz).date;

    // Today's shifts (needs todayStr from timezone)
    const { data: todayShiftsData } = await adminClient
      .from("shifts")
      .select("id, status")
      .eq("business_id", ctx.businessId)
      .eq("date", todayStr);

    // ── Derive employee-dependent values ──
    const totalEmployees = employees?.length || 0;
    const activeEmployees = employees?.filter((e) => e.employment_status === "active").length || 0;
    const employeeIds = employees?.map((e) => e.id) || [];

    // Today's shifts breakdown
    const todayShifts = todayShiftsData?.length || 0;
    const todayAssigned = todayShiftsData?.filter((s) => ["pending", "accepted", "updated_pending"].includes(s.status)).length || 0;
    const todayCompleted = todayShiftsData?.filter((s) => s.status === "completed").length || 0;
    const todayNoShows = todayShiftsData?.filter((s) => s.status === "declined" || s.status === "cancelled").length || 0;

    const taskProofPending = !proofErr ? (proofCount || 0) : 0;

    // ── Wave 2: Queries that depend on wave 1 results ──
    const todayShiftIds = (todayShiftsData || []).filter((s) => s.status === "accepted").map((s) => s.id);

    const [inProgressResult, timesheetResult, unpaidResult] = await Promise.all([
      // In-progress work sessions
      todayShiftIds.length > 0
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (adminClient as any)
            .from("work_sessions")
            .select("*", { count: "exact", head: true })
            .in("shift_id", todayShiftIds)
            .eq("status", "working")
        : Promise.resolve({ count: 0 }),
      // Submitted timesheets
      employeeIds.length > 0
        ? adminClient
            .from("timesheets")
            .select("*", { count: "exact", head: true })
            .in("employee_id", employeeIds)
            .eq("status", "submitted")
        : Promise.resolve({ count: 0 }),
      // Unpaid payments
      employeeIds.length > 0
        ? adminClient
            .from("payments")
            .select("total_amount")
            .in("employee_id", employeeIds)
            .eq("status", "unpaid")
        : Promise.resolve({ data: [] }),
    ]);

    const todayInProgress = inProgressResult.count || 0;
    const submittedTimesheets = timesheetResult.count || 0;
    const unpaidData = unpaidResult.data || [];
    const unpaidPayments = unpaidData.length;
    const unpaidAmount = unpaidData.reduce((sum: number, p: { total_amount: number }) => sum + p.total_amount, 0);

    const response = NextResponse.json({
      totalEmployees,
      activeEmployees,
      pendingShifts: pendingShifts || 0,
      todayShifts,
      todayAssigned,
      todayInProgress,
      todayCompleted,
      todayNoShows,
      submittedTimesheets,
      unpaidPayments,
      unpaidAmount,
      attendanceReview: attendanceReview || 0,
      siteIssues: siteIssues || 0,
      taskProofPending,
      actionRequired: actionItems || [],
      unreadNotifications: unreadNotifications || 0,
    });

    // Cache for 30s, serve stale while revalidating for up to 60s
    response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");

    return response;
  } catch (err) {
    return handleTenantError(err);
  }
}
