// GET /api/static-qr?locationId=... — get active/paused credential for a location
// POST /api/static-qr — generate a new static QR credential for a location
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, requireMember, handleTenantError } from "@/lib/services/tenantContext";
import crypto from "crypto";

export async function GET(request: Request) {
  try {
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

    // Get the active or paused credential (partial unique index ensures at most one)
    const { data: credential, error } = await adminClient
      .from("static_qr_credentials")
      .select("*")
      .eq("location_id", locationId)
      .eq("business_id", ctx.businessId)
      .in("status", ["ACTIVE", "PAUSED"])
      .single();

    if (error && error.code !== "PGRST116") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Return credential or null (no credential = not generated yet)
    return NextResponse.json(credential || null);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();

    const body = await request.json();
    const { locationId } = body;

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
        { error: "Cannot generate QR for an archived location." },
        { status: 400 }
      );
    }

    // Revoke any existing active/paused credential for this location
    await adminClient
      .from("static_qr_credentials")
      .update({ status: "REVOKED", regenerated_at: new Date().toISOString() })
      .eq("location_id", locationId)
      .eq("business_id", ctx.businessId)
      .in("status", ["ACTIVE", "PAUSED"]);

    // Generate a secure random token (64-char hex = 32 bytes of entropy)
    const token = crypto.randomBytes(32).toString("hex");

    // Insert the new credential
    const { data: credential, error } = await adminClient
      .from("static_qr_credentials")
      .insert({
        business_id: ctx.businessId,
        location_id: locationId,
        token,
        status: "ACTIVE",
        created_by: ctx.userId,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(credential, { status: 201 });
  } catch (err) {
    return handleTenantError(err);
  }
}
