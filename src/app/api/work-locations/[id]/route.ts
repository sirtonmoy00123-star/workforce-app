// GET /api/work-locations/[id] — get a single work location
// PUT /api/work-locations/[id] — update a work location
// DELETE /api/work-locations/[id] — archive a work location (soft delete)
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAdmin();
    const { id } = await params;

    const adminClient = createAdminClient();
    const { data: location, error } = await adminClient
      .from("work_locations")
      .select("*")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (error || !location) {
      return NextResponse.json({ error: "Location not found." }, { status: 404 });
    }

    return NextResponse.json(location);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAdmin();
    const { id } = await params;

    const body = await request.json();
    const { name, address, latitude, longitude } = body;

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: "Location name is required." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // Verify location belongs to this business
    const { data: existing } = await adminClient
      .from("work_locations")
      .select("id")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Location not found." }, { status: 404 });
    }

    // Check for duplicate name (excluding current location)
    const { data: duplicate } = await adminClient
      .from("work_locations")
      .select("id")
      .eq("business_id", ctx.businessId)
      .eq("name", name.trim())
      .eq("status", "ACTIVE")
      .neq("id", id)
      .limit(1);

    if (duplicate && duplicate.length > 0) {
      return NextResponse.json(
        { error: `A location named "${name.trim()}" already exists.` },
        { status: 400 }
      );
    }

    // Validate coordinates if provided
    if (latitude !== undefined && latitude !== null) {
      const lat = Number(latitude);
      if (isNaN(lat) || lat < -90 || lat > 90) {
        return NextResponse.json(
          { error: "Latitude must be between -90 and 90." },
          { status: 400 }
        );
      }
    }
    if (longitude !== undefined && longitude !== null) {
      const lng = Number(longitude);
      if (isNaN(lng) || lng < -180 || lng > 180) {
        return NextResponse.json(
          { error: "Longitude must be between -180 and 180." },
          { status: 400 }
        );
      }
    }

    const { data: location, error } = await adminClient
      .from("work_locations")
      .update({
        name: name.trim(),
        address: address?.trim() || null,
        latitude: latitude != null ? Number(latitude) : null,
        longitude: longitude != null ? Number(longitude) : null,
      })
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(location);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAdmin();
    const { id } = await params;

    const adminClient = createAdminClient();

    // Verify location belongs to this business
    const { data: existing } = await adminClient
      .from("work_locations")
      .select("id, status")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "Location not found." }, { status: 404 });
    }

    if (existing.status === "ARCHIVED") {
      return NextResponse.json({ error: "Location is already archived." }, { status: 400 });
    }

    // Check if any shifts reference this location
    const { data: linkedShifts } = await adminClient
      .from("shifts")
      .select("id")
      .eq("location_id", id)
      .limit(1);

    // Soft delete — archive, don't destroy
    const { error } = await adminClient
      .from("work_locations")
      .update({ status: "ARCHIVED" })
      .eq("id", id)
      .eq("business_id", ctx.businessId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
      success: true,
      hasLinkedShifts: !!(linkedShifts && linkedShifts.length > 0),
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
