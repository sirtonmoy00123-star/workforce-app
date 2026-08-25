// GET /api/dynamic-qr?locationId=... — generate a fresh dynamic QR token
// Returns a signed token with expiration based on attendance_settings.dynamic_qr_refresh_seconds
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";
import { generateDynamicQrToken } from "@/lib/services/dynamicQr";

export async function GET(request: Request) {
  try {
    // Only admins generate dynamic QR tokens (they display on their screen)
    const ctx = await requireAdmin();

    const url = new URL(request.url);
    const locationId = url.searchParams.get("locationId");

    if (!locationId) {
      return NextResponse.json(
        { error: "locationId is required." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // Verify location belongs to this business and is ACTIVE
    const { data: location } = await adminClient
      .from("work_locations")
      .select("id, name, status")
      .eq("id", locationId)
      .eq("business_id", ctx.businessId)
      .single();

    if (!location) {
      return NextResponse.json({ error: "Location not found." }, { status: 404 });
    }

    if (location.status !== "ACTIVE") {
      return NextResponse.json(
        { error: "Location is archived." },
        { status: 400 }
      );
    }

    // Get attendance settings for the refresh interval
    const { data: settings } = await adminClient
      .from("attendance_settings")
      .select("attendance_required, qr_required, qr_mode, dynamic_qr_refresh_seconds")
      .eq("location_id", locationId)
      .eq("business_id", ctx.businessId)
      .single();

    if (!settings || !settings.attendance_required || !settings.qr_required) {
      return NextResponse.json(
        { error: "QR attendance is not enabled for this location." },
        { status: 400 }
      );
    }

    if (settings.qr_mode !== "DYNAMIC") {
      return NextResponse.json(
        { error: "This location uses Static QR, not Dynamic." },
        { status: 400 }
      );
    }

    const ttl = settings.dynamic_qr_refresh_seconds || 60;

    // Generate the signed token
    const result = generateDynamicQrToken(locationId, ctx.businessId, ttl);

    return NextResponse.json({
      token: result.token,
      expiresAt: result.expiresAt,
      issuedAt: result.issuedAt,
      ttlSeconds: ttl,
      locationName: location.name,
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
