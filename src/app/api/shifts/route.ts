// GET /api/shifts — list shifts (with optional date range filter)
// POST /api/shifts — create a new shift
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, requireAdmin, handleTenantError } from "@/lib/services/tenantContext";
import { buildShiftTimestamps, getBusinessTimezone } from "@/lib/calculations/timezone";
import { shiftAudit } from "@/lib/services/auditService";
import { validateShiftAssignment, type ShiftAssignmentInput, type EmployeeData, type ExistingShiftData } from "@/lib/services/shiftValidation";

export async function GET(request: Request) {
  try {
    const ctx = await requireMember();
    const adminClient = createAdminClient();

    const url = new URL(request.url);
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const employeeId = url.searchParams.get("employeeId");

    let query = adminClient.from("shifts").select("*");

    if (ctx.role === "OWNER" || ctx.role === "ADMIN") {
      query = query.eq("business_id", ctx.businessId);
    } else {
      // Employee only sees their own shifts
      if (!ctx.employeeId) return NextResponse.json([]);
      query = query.eq("employee_id", ctx.employeeId);
    }

    if (startDate) query = query.gte("date", startDate);
    if (endDate) query = query.lte("date", endDate);
    if (employeeId) query = query.eq("employee_id", employeeId);

    query = query.order("date").order("scheduled_start");

    const { data: shifts, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(shifts || []);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();

    const body = await request.json();
    const { employeeId, date, startTime, endTime, location, instructions, overrideAvailability, timezoneOffsetMinutes, requireOdometer } = body;

    if (!employeeId || !date || !startTime || !endTime) {
      return NextResponse.json(
        { error: "Employee, date, start time, and end time are required." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // 1. Verify employee is active and in same business
    const { data: employee } = await adminClient
      .from("employees")
      .select("*")
      .eq("id", employeeId)
      .eq("business_id", ctx.businessId)
      .single();

    if (!employee) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    if (employee.employment_status !== "active") {
      return NextResponse.json({ error: "Employee is not active." }, { status: 400 });
    }

    // Build full timestamps using business timezone (IANA-based, DST-safe).
    // Falls back to timezoneOffsetMinutes for backward compat if timezone lookup fails.
    let scheduledStart: string;
    let scheduledFinish: string;
    try {
      const tz = await getBusinessTimezone(ctx.businessId);
      const stamps = buildShiftTimestamps(date, startTime, endTime, tz);
      scheduledStart = stamps.scheduledStart;
      scheduledFinish = stamps.scheduledFinish;
    } catch {
      // Fallback: use the legacy offset-based approach
      const offsetMin = typeof timezoneOffsetMinutes === "number" ? timezoneOffsetMinutes : 0;
      const sign = offsetMin <= 0 ? "+" : "-";
      const absMin = Math.abs(offsetMin);
      const offH = String(Math.floor(absMin / 60)).padStart(2, "0");
      const offM = String(absMin % 60).padStart(2, "0");
      const tzSuffix = `${sign}${offH}:${offM}`;
      scheduledStart = new Date(`${date}T${startTime}:00${tzSuffix}`).toISOString();
      scheduledFinish = new Date(`${date}T${endTime}:00${tzSuffix}`).toISOString();
    }

    // 2. Fetch data for enhanced validation (parallel)
    const shiftDate = new Date(date);
    const dayOfWeek = shiftDate.getDay(); // 0=Sun … 6=Sat

    // Date range for existing shifts lookup (±7 days for weekly hours + rest checks)
    const weekStart = new Date(shiftDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekStartStr = weekStart.toISOString().slice(0, 10);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    // Adjacent days for overlap + rest period checks
    const prevDay = new Date(new Date(date + "T12:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
    const nextDay = new Date(new Date(date + "T12:00:00Z").getTime() + 86400000).toISOString().slice(0, 10);

    const [availResult, existingShiftsResult, weekShiftsResult, leaveResult] = await Promise.all([
      // Availability for this day
      adminClient
        .from("employee_availability")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("day_of_week", dayOfWeek)
        .single(),
      // Existing shifts for overlap + rest check (adjacent days)
      adminClient
        .from("shifts")
        .select("id, employee_id, date, scheduled_start, scheduled_finish, status, location, location_id")
        .eq("employee_id", employeeId)
        .gte("date", prevDay)
        .lte("date", nextDay)
        .not("status", "in", '("cancelled","declined")'),
      // Week shifts for weekly hours check
      adminClient
        .from("shifts")
        .select("id, employee_id, date, scheduled_start, scheduled_finish, status")
        .eq("employee_id", employeeId)
        .gte("date", weekStartStr)
        .lte("date", weekEndStr)
        .not("status", "in", '("cancelled","declined")'),
      // Approved leave for conflict check
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (adminClient as any)
        .from("employee_leave")
        .select("id, leave_type, start_date, end_date, status")
        .eq("employee_id", employeeId)
        .eq("status", "APPROVED")
        .lte("start_date", date)
        .gte("end_date", date),
    ]);

    // 3. Run enhanced validation
    const validationInput: ShiftAssignmentInput = {
      employeeId,
      businessId: ctx.businessId,
      date,
      startTime,
      endTime,
      location: location || undefined,
    };

    const employeeData: EmployeeData = {
      id: employee.id,
      business_id: employee.business_id,
      full_name: employee.full_name,
      employment_status: employee.employment_status,
    };

    const availability = availResult.data || null;
    const existingShifts: ExistingShiftData[] = existingShiftsResult.data || [];
    const approvedLeave = leaveResult.data || [];
    const weekShifts: ExistingShiftData[] = weekShiftsResult.data || [];

    const result = validateShiftAssignment(
      validationInput,
      employeeData,
      availability,
      existingShifts,
      approvedLeave,
      weekShifts,
    );

    // Hard block on errors
    if (result.errors.length > 0) {
      return NextResponse.json(
        { error: result.errors[0].message, issues: result.errors },
        { status: 400 }
      );
    }

    // Warnings: return 409 unless overridden
    if (result.warnings.length > 0 && !overrideAvailability) {
      return NextResponse.json(
        {
          warning: true,
          message: result.warnings.map((w) => w.message).join(" "),
          issues: result.warnings,
        },
        { status: 409 }
      );
    }

    // 4. Auto-link location_id if location text matches a work_location name
    let locationId: string | null = null;
    if (location) {
      const { data: wl } = await adminClient
        .from("work_locations")
        .select("id")
        .eq("business_id", ctx.businessId)
        .ilike("name", location)
        .eq("status", "ACTIVE")
        .limit(1)
        .single();
      if (wl) locationId = wl.id;
    }

    // 5. Create the shift with rate snapshots
    const { data: shift, error } = await adminClient
      .from("shifts")
      .insert({
        business_id: ctx.businessId,
        employee_id: employeeId,
        date,
        scheduled_start: scheduledStart,
        scheduled_finish: scheduledFinish,
        location: location || null,
        location_id: locationId,
        instructions: instructions || null,
        require_odometer: typeof requireOdometer === "boolean" ? requireOdometer : null,
        hourly_rate_snapshot: employee.hourly_rate,
        mileage_rate_snapshot: employee.mileage_rate,
        status: "pending",
        created_by: ctx.userId,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fire-and-forget audit
    shiftAudit(
      "SHIFT_CREATED",
      { businessId: ctx.businessId, userId: ctx.userId, role: ctx.role },
      shift.id,
      {
        after: {
          employee_id: employeeId,
          date,
          scheduled_start: scheduledStart,
          scheduled_finish: scheduledFinish,
          location: location || null,
        },
      }
    );

    return NextResponse.json({ success: true, shift });
  } catch (err) {
    return handleTenantError(err);
  }
}
