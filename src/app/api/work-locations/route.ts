// GET /api/work-locations — list work locations for the admin's business
// POST /api/work-locations — create a new work location
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, requireMember, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(request: Request) {
  try {
    // Both admin and employee can list locations (employee needs for check-in)
    const ctx = await requireMember();

    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("includeArchived") === "true";

    const adminClient = createAdminClient();
    let query = adminClient
      .from("work_locations")
      .select("*")
      .eq("business_id", ctx.businessId)
      .order("name");

    if (!includeArchived) {
      query = query.eq("status", "ACTIVE");
    }

    const { data: locations, error } = await query;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(locations);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();

    const body = await request.json();
    const { name, address, latitude, longitude } = body;

    // Validation
    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: "Location name is required." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // Check for duplicate name in same business (active locations only)
    const { data: existing } = await adminClient
      .from("work_locations")
      .select("id")
      .eq("business_id", ctx.businessId)
      .eq("name", name.trim())
      .eq("status", "ACTIVE")
      .limit(1);

    if (existing && existing.length > 0) {
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
      .insert({
        business_id: ctx.businessId,
        name: name.trim(),
        address: address?.trim() || null,
        latitude: latitude != null ? Number(latitude) : null,
        longitude: longitude != null ? Number(longitude) : null,
        created_by: ctx.userId,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(location, { status: 201 });
  } catch (err) {
    return handleTenantError(err);
  }
}
