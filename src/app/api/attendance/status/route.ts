// GET /api/attendance/status?shiftId=... — get attendance record + settings for a shift
// Returns: attendance record (if exists), attendance settings for the shift's location,
// and what steps are required for check-in.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(request: Request) {
  try {
    const ctx = await requireMember();

    const url = new URL(request.url);
    const shiftId = url.searchParams.get("shiftId");

    if (!shiftId) {
      return NextResponse.json({ error: "shiftId is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Get the shift with location_id
    const { data: shift } = await adminClient
      .from("shifts")
      .select("id, location_id, scheduled_start, scheduled_finish, status, employee_id")
      .eq("id", shiftId)
      .eq("business_id", ctx.businessId)
      .single();

    if (!shift) {
      return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    }

    // Employee isolation: non-admin can only see their own shift's attendance
    const isAdmin = ctx.role === "OWNER" || ctx.role === "ADMIN";
    if (!isAdmin && ctx.employeeId && shift.employee_id !== ctx.employeeId) {
      return NextResponse.json({ error: "This shift is not assigned to you." }, { status: 403 });
    }

    // Get existing attendance record (if any) — select only needed fields, no internal paths
    const { data: record } = await adminClient
      .from("attendance_records")
      .select(
        "id, shift_id, employee_id, checkin_status, checkout_status, " +
        "actual_checkin, actual_checkout, qr_verified, " +
        "verification_status, requires_review, approved_start, approved_finish"
      )
      .eq("shift_id", shiftId)
      .eq("business_id", ctx.businessId)
      .single();

    // If no location_id, attendance isn't configured
    if (!shift.location_id) {
      return NextResponse.json({
        attendanceRequired: false,
        record: record || null,
        settings: null,
        location: null,
        steps: [],
      });
    }

    // Get attendance settings for this location
    const { data: settings } = await adminClient
      .from("attendance_settings")
      .select("*")
      .eq("location_id", shift.location_id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!settings || !settings.attendance_required) {
      return NextResponse.json({
        attendanceRequired: false,
        record: record || null,
        settings: settings || null,
        location: null,
        steps: [],
      });
    }

    // Get location details
    const { data: location } = await adminClient
      .from("work_locations")
      .select("id, name, latitude, longitude")
      .eq("id", shift.location_id)
      .single();

    // Determine required check-in steps
    const steps: string[] = [];
    if (settings.qr_required) steps.push("QR_SCAN");
    if (settings.gps_required) steps.push("GPS_VERIFY");
    if (settings.selfie_required) steps.push("SELFIE");
    if (settings.site_photo_required) steps.push("SITE_PHOTO");

    return NextResponse.json({
      attendanceRequired: true,
      record: record || null,
      settings,
      location,
      steps,
      shift: {
        id: shift.id,
        scheduled_start: shift.scheduled_start,
        scheduled_finish: shift.scheduled_finish,
        status: shift.status,
      },
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
