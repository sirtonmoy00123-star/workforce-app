// GET /api/shifts — list shifts (with optional date range filter)
// POST /api/shifts — create a new shift
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

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
    const { employeeId, date, startTime, endTime, location, instructions, overrideAvailability, timezoneOffsetMinutes } = body;

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

    // Build full timestamps with the client's timezone offset so the stored
    // UTC value matches the wall-clock time the admin intended.
    // getTimezoneOffset() returns negative for east-of-UTC, e.g. -600 for UTC+10.
    const offsetMin = typeof timezoneOffsetMinutes === "number" ? timezoneOffsetMinutes : 0;
    const sign = offsetMin <= 0 ? "+" : "-";
    const absMin = Math.abs(offsetMin);
    const offH = String(Math.floor(absMin / 60)).padStart(2, "0");
    const offM = String(absMin % 60).padStart(2, "0");
    const tzSuffix = `${sign}${offH}:${offM}`;

    const scheduledStart = new Date(`${date}T${startTime}:00${tzSuffix}`).toISOString();
    const scheduledFinish = new Date(`${date}T${endTime}:00${tzSuffix}`).toISOString();

    // 2. Check for overlapping shifts
    const { data: overlapping } = await adminClient
      .from("shifts")
      .select("id")
      .eq("employee_id", employeeId)
      .eq("date", date)
      .not("status", "in", '("cancelled","declined")')
      .or(`and(scheduled_start.lt.${scheduledFinish},scheduled_finish.gt.${scheduledStart})`);

    if (overlapping && overlapping.length > 0) {
      return NextResponse.json(
        { error: "Employee already has an overlapping shift on this date." },
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

    // 4. Create the shift
    const { data: shift, error } = await adminClient
      .from("shifts")
      .insert({
        business_id: ctx.businessId,
        employee_id: employeeId,
        date,
        scheduled_start: scheduledStart,
        scheduled_finish: scheduledFinish,
        location: location || null,
        instructions: instructions || null,
        status: "pending",
        created_by: ctx.userId,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, shift });
  } catch (err) {
    return handleTenantError(err);
  }
}
