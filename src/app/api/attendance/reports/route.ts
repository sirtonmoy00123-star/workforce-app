// GET /api/attendance/reports?startDate=...&endDate=...&employeeId=...&locationId=...&status=...
// Returns attendance report data with summary stats.
// Admin sees all employees in their business; employee sees only their own.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(request: Request) {
  try {
    const ctx = await requireMember();
    const url = new URL(request.url);
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const employeeIdFilter = url.searchParams.get("employeeId");
    const locationIdFilter = url.searchParams.get("locationId");
    const statusFilter = url.searchParams.get("status"); // PRESENT, LATE, ABSENT, NEEDS_REVIEW

    if (!startDate || !endDate) {
      return NextResponse.json({ error: "startDate and endDate are required." }, { status: 400 });
    }

    const adminClient = createAdminClient();
    const isAdmin = ctx.role === "OWNER" || ctx.role === "ADMIN";

    // Get shifts in the date range
    let shiftsQuery = adminClient
      .from("shifts")
      .select("id, employee_id, date, scheduled_start, scheduled_finish, location, location_id, status")
      .eq("business_id", ctx.businessId)
      .gte("date", startDate)
      .lte("date", endDate)
      .in("status", ["accepted", "completed"]);

    // Employee can only see their own
    if (!isAdmin) {
      if (!ctx.employeeId) return NextResponse.json({ records: [], summary: {} });
      shiftsQuery = shiftsQuery.eq("employee_id", ctx.employeeId);
    } else if (employeeIdFilter) {
      shiftsQuery = shiftsQuery.eq("employee_id", employeeIdFilter);
    }

    if (locationIdFilter) {
      shiftsQuery = shiftsQuery.eq("location_id", locationIdFilter);
    }

    const { data: shifts } = await shiftsQuery.order("date", { ascending: false });

    if (!shifts || shifts.length === 0) {
      return NextResponse.json({
        records: [],
        summary: {
          scheduled: 0, present: 0, late: 0, absent: 0,
          earlyDepartures: 0, lateFinishes: 0, needsReview: 0,
          totalLateMinutes: 0, approvedExtraMinutes: 0, attendanceRate: 0,
        },
      });
    }

    const shiftIds = shifts.map((s) => s.id);

    // Get attendance records for these shifts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: records } = await adminClient
      .from("attendance_records")
      .select(
        "id, shift_id, employee_id, checkin_status, checkout_status, " +
        "actual_checkin, actual_checkout, checkin_distance_metres, " +
        "verification_status, requires_review, approved_start, approved_finish"
      )
      .eq("business_id", ctx.businessId)
      .in("shift_id", shiftIds) as { data: Record<string, any>[] | null };

    // Get exceptions for these records
    const recordIds = (records || []).map((r: Record<string, any>) => r.id as string);
    let exceptions: { id: string; attendance_record_id: string; exception_type: string; difference_minutes: number | null; status: string }[] = [];
    if (recordIds.length > 0) {
      const { data: exc } = await adminClient
        .from("attendance_exceptions")
        .select("id, attendance_record_id, exception_type, difference_minutes, status")
        .in("attendance_record_id", recordIds);
      exceptions = exc || [];
    }

    // Get employee names (admin only)
    let employeeMap: Record<string, { full_name: string; employee_number: string }> = {};
    if (isAdmin) {
      const employeeIds = [...new Set(shifts.map((s) => s.employee_id))];
      const { data: employees } = await adminClient
        .from("employees")
        .select("id, full_name, employee_number")
        .in("id", employeeIds);
      if (employees) {
        employeeMap = Object.fromEntries(employees.map((e) => [e.id, { full_name: e.full_name, employee_number: e.employee_number }]));
      }
    }

    // Build record map keyed by shift_id
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recordMap = Object.fromEntries((records || []).map((r: Record<string, any>) => [r.shift_id, r]));
    const exceptionMap: Record<string, typeof exceptions> = {};
    for (const exc of exceptions) {
      if (!exceptionMap[exc.attendance_record_id]) exceptionMap[exc.attendance_record_id] = [];
      exceptionMap[exc.attendance_record_id].push(exc);
    }

    // Build daily records
    interface DailyRecord {
      shift_id: string;
      employee_id: string;
      employee_name: string;
      employee_number: string;
      date: string;
      scheduled_start: string;
      scheduled_finish: string;
      location: string | null;
      checkin_time: string | null;
      checkout_time: string | null;
      checkin_status: string;
      checkout_status: string;
      verification_status: string;
      approved_start: string | null;
      approved_finish: string | null;
      exceptions: { type: string; minutes: number | null; status: string }[];
    }

    const dailyRecords: DailyRecord[] = [];

    // Summary counters
    let scheduled = 0;
    let present = 0;
    let late = 0;
    let absent = 0;
    let earlyDepartures = 0;
    let lateFinishes = 0;
    let needsReview = 0;
    let totalLateMinutes = 0;
    let approvedExtraMinutes = 0;

    for (const shift of shifts) {
      const attendance = recordMap[shift.id];
      const emp = employeeMap[shift.employee_id];

      scheduled++;

      const checkinStatus = attendance?.checkin_status || "NOT_CHECKED_IN";
      const checkoutStatus = attendance?.checkout_status || "NOT_CHECKED_OUT";
      const verificationStatus = attendance?.verification_status || "PENDING";

      // Count statuses
      if (!attendance) {
        // No attendance record — check if shift date is in the past
        const shiftDate = new Date(shift.date + "T23:59:59");
        if (shiftDate < new Date()) {
          absent++;
        }
      } else {
        if (checkinStatus === "PRESENT" || checkinStatus === "APPROVED_MANUALLY") present++;
        else if (checkinStatus === "LATE") { late++; present++; } // Late is still present
        else if (checkinStatus === "NEEDS_REVIEW") needsReview++;

        if (checkoutStatus === "EARLY_DEPARTURE") earlyDepartures++;
        if (checkoutStatus === "LATE_DEPARTURE") lateFinishes++;
      }

      // Apply status filter
      if (statusFilter) {
        if (statusFilter === "PRESENT" && checkinStatus !== "PRESENT" && checkinStatus !== "LATE" && checkinStatus !== "APPROVED_MANUALLY") continue;
        if (statusFilter === "LATE" && checkinStatus !== "LATE") continue;
        if (statusFilter === "ABSENT" && attendance) continue;
        if (statusFilter === "NEEDS_REVIEW" && verificationStatus !== "NEEDS_REVIEW") continue;
      }

      // Get exceptions for this record
      const recExceptions = attendance ? (exceptionMap[attendance.id] || []) : [];
      for (const exc of recExceptions) {
        if (exc.exception_type === "LATE_ARRIVAL" && exc.difference_minutes) {
          totalLateMinutes += exc.difference_minutes;
        }
        if (exc.exception_type === "LATE_DEPARTURE" && exc.difference_minutes && exc.status === "APPROVED") {
          approvedExtraMinutes += exc.difference_minutes;
        }
      }

      dailyRecords.push({
        shift_id: shift.id,
        employee_id: shift.employee_id,
        employee_name: emp?.full_name || "",
        employee_number: emp?.employee_number || "",
        date: shift.date,
        scheduled_start: shift.scheduled_start,
        scheduled_finish: shift.scheduled_finish,
        location: shift.location,
        checkin_time: attendance?.actual_checkin || null,
        checkout_time: attendance?.actual_checkout || null,
        checkin_status: checkinStatus,
        checkout_status: checkoutStatus,
        verification_status: verificationStatus,
        approved_start: attendance?.approved_start || null,
        approved_finish: attendance?.approved_finish || null,
        exceptions: recExceptions.map((e) => ({
          type: e.exception_type,
          minutes: e.difference_minutes,
          status: e.status,
        })),
      });
    }

    const attendanceRate = scheduled > 0
      ? Math.round(((present + late) / scheduled) * 100)
      : 0;

    return NextResponse.json({
      records: dailyRecords,
      summary: {
        scheduled,
        present,
        late,
        absent,
        earlyDepartures,
        lateFinishes,
        needsReview,
        totalLateMinutes,
        approvedExtraMinutes,
        attendanceRate,
      },
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
