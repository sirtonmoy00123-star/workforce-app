// GET /api/shifts — list shifts (with optional date range filter)
// POST /api/shifts — create a new shift
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { data: appUser } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", user.id)
      .single();

    if (!appUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const url = new URL(request.url);
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const employeeId = url.searchParams.get("employeeId");

    let query = supabase.from("shifts").select("*");

    if (appUser.role === "admin") {
      query = query.eq("business_id", appUser.business_id);
    } else {
      // Employee only sees their own shifts
      const { data: emp } = await supabase
        .from("employees")
        .select("id")
        .eq("user_id", appUser.id)
        .single();
      if (!emp) return NextResponse.json([]);
      query = query.eq("employee_id", emp.id);
    }

    if (startDate) query = query.gte("date", startDate);
    if (endDate) query = query.lte("date", endDate);
    if (employeeId) query = query.eq("employee_id", employeeId);

    query = query.order("date").order("scheduled_start");

    const { data: shifts, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(shifts || []);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { data: appUser } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", user.id)
      .single();

    if (!appUser || appUser.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { employeeId, date, startTime, endTime, location, instructions, overrideAvailability } = body;

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
      .eq("business_id", appUser.business_id)
      .single();

    if (!employee) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    if (employee.employment_status !== "active") {
      return NextResponse.json({ error: "Employee is not active." }, { status: 400 });
    }

    // Build full timestamps with timezone offset so they're stored correctly.
    // The admin enters times in their local timezone, so we create Date objects
    // from the local date+time and use their ISO representation.
    const startDate = new Date(`${date}T${startTime}:00`);
    const endDate = new Date(`${date}T${endTime}:00`);
    const scheduledStart = startDate.toISOString();
    const scheduledFinish = endDate.toISOString();

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
      // Check if shift falls within availability window
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
        business_id: appUser.business_id,
        employee_id: employeeId,
        date,
        scheduled_start: scheduledStart,
        scheduled_finish: scheduledFinish,
        location: location || null,
        instructions: instructions || null,
        status: "pending",
        created_by: appUser.id,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, shift });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
