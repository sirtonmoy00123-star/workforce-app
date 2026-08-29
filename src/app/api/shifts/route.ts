// GET /api/shifts — list shifts (with optional date range filter)
// POST /api/shifts — create a new shift
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, requireAdmin, handleTenantError } from "@/lib/services/tenantContext";
import { buildShiftTimestamps, getBusinessTimezone } from "@/lib/calculations/timezone";
import { shiftAudit } from "@/lib/services/auditService";

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

    // 2. Check for overlapping shifts — query adjacent days for overnight shift detection
    const createPrevDay = new Date(new Date(date + "T12:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
    const createNextDay = new Date(new Date(date + "T12:00:00Z").getTime() + 86400000).toISOString().slice(0, 10);
    const { data: overlapping } = await adminClient
      .from("shifts")
      .select("id")
      .eq("employee_id", employeeId)
      .gte("date", createPrevDay)
      .lte("date", createNextDay)
      .not("status", "in", '("cancelled","declined")')
      .or(`and(scheduled_start.lt.${scheduledFinish},scheduled_finish.gt.${scheduledStart})`);

    if (overlapping && overlapping.length > 0) {
      return NextResponse.json(
        { error: "Employee already has an overlapping shift." },
        { status: 400 }
      );
    }

    // 3. Check availability (warn, don't block if overridden)
    const shiftDate = new Date(date);
    const dayOfWeek = shiftDate.getDay(); // 0=Sun … 6=Sat

    const { data: avail } = await adminClient
      .from("employee_availability")
      .select("*")
      .eq("employee_id", employeeId)
      .eq("day_of_week", dayOfWeek)
      .single();

    let availabilityWarning = false;
    if (!avail || !avail.is_available) {
      availabilityWarning = true;
    } else if (avail.start_time && avail.end_time) {
      if (startTime < avail.start_time.substring(0, 5) || endTime > avail.end_time.substring(0, 5)) {
        availabilityWarning = true;
      }
    }

    if (availabilityWarning && !overrideAvailability) {
      return NextResponse.json(
        {
          warning: true,
          message: "Warning: Employee is not available for the full shift.",
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
