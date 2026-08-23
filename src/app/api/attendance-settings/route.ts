// GET /api/attendance-settings?locationId=... — get settings for a location
// POST /api/attendance-settings — create or update settings for a location (upsert)
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, requireMember, handleTenantError } from "@/lib/services/tenantContext";

const VALID_QR_MODES = ["STATIC", "DYNAMIC"];
const VALID_CHECKOUT_METHODS = ["BUTTON_ONLY", "GPS_ONLY", "QR_GPS", "QR_GPS_SELFIE"];
const VALID_ROUNDING = [0, 5, 10, 15, 30];

export async function GET(request: Request) {
  try {
    // Both admin and employee can read settings (employee needs for check-in)
    const ctx = await requireMember();

    const url = new URL(request.url);
    const locationId = url.searchParams.get("locationId");

    if (!locationId) {
      return NextResponse.json(
        { error: "locationId is required." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // Verify location belongs to this business
    const { data: location } = await adminClient
      .from("work_locations")
      .select("id")
      .eq("id", locationId)
      .eq("business_id", ctx.businessId)
      .single();

    if (!location) {
      return NextResponse.json({ error: "Location not found." }, { status: 404 });
    }

    const { data: settings, error } = await adminClient
      .from("attendance_settings")
      .select("*")
      .eq("location_id", locationId)
      .eq("business_id", ctx.businessId)
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows — that's fine, means no settings configured yet
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Return settings or null (no settings = attendance not configured)
    return NextResponse.json(settings || null);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();

    const body = await request.json();
    const { locationId, ...settingsData } = body;

    if (!locationId) {
      return NextResponse.json(
        { error: "locationId is required." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // Verify location belongs to this business
    const { data: location } = await adminClient
      .from("work_locations")
      .select("id")
      .eq("id", locationId)
      .eq("business_id", ctx.businessId)
      .single();

    if (!location) {
      return NextResponse.json({ error: "Location not found." }, { status: 404 });
    }

    // Validate fields
    if (settingsData.qr_mode && !VALID_QR_MODES.includes(settingsData.qr_mode)) {
      return NextResponse.json(
        { error: `Invalid QR mode. Must be one of: ${VALID_QR_MODES.join(", ")}` },
        { status: 400 }
      );
    }

    if (settingsData.checkout_method && !VALID_CHECKOUT_METHODS.includes(settingsData.checkout_method)) {
      return NextResponse.json(
        { error: `Invalid checkout method. Must be one of: ${VALID_CHECKOUT_METHODS.join(", ")}` },
        { status: 400 }
      );
    }

    if (settingsData.rounding_minutes !== undefined && !VALID_ROUNDING.includes(settingsData.rounding_minutes)) {
      return NextResponse.json(
        { error: `Invalid rounding. Must be one of: ${VALID_ROUNDING.join(", ")}` },
        { status: 400 }
      );
    }

    if (settingsData.allowed_radius_metres !== undefined) {
      const radius = Number(settingsData.allowed_radius_metres);
      if (isNaN(radius) || radius < 10 || radius > 5000) {
        return NextResponse.json(
          { error: "Allowed radius must be between 10 and 5000 metres." },
          { status: 400 }
        );
      }
    }

    if (settingsData.dynamic_qr_refresh_seconds !== undefined) {
      const refresh = Number(settingsData.dynamic_qr_refresh_seconds);
      if (isNaN(refresh) || refresh < 15 || refresh > 300) {
        return NextResponse.json(
          { error: "QR refresh interval must be between 15 and 300 seconds." },
          { status: 400 }
        );
      }
    }

    // Build the row to upsert
    const row = {
      business_id: ctx.businessId,
      location_id: locationId,
      attendance_required: settingsData.attendance_required ?? false,
      qr_required: settingsData.qr_required ?? false,
      qr_mode: settingsData.qr_mode ?? "STATIC",
      gps_required: settingsData.gps_required ?? false,
      allowed_radius_metres: settingsData.allowed_radius_metres ?? 100,
      selfie_required: settingsData.selfie_required ?? false,
      site_photo_required: settingsData.site_photo_required ?? false,
      early_checkin_minutes: settingsData.early_checkin_minutes ?? 15,
      late_grace_minutes: settingsData.late_grace_minutes ?? 10,
      early_departure_review_minutes: settingsData.early_departure_review_minutes ?? 10,
      late_finish_review_minutes: settingsData.late_finish_review_minutes ?? 15,
      rounding_minutes: settingsData.rounding_minutes ?? 0,
      checkout_method: settingsData.checkout_method ?? "BUTTON_ONLY",
      dynamic_qr_refresh_seconds: settingsData.dynamic_qr_refresh_seconds ?? 60,
    };

    // Upsert: insert or update based on location_id unique constraint
    const { data: settings, error } = await adminClient
      .from("attendance_settings")
      .upsert(row, { onConflict: "location_id" })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(settings);
  } catch (err) {
    return handleTenantError(err);
  }
}
