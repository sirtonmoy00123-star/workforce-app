// GET /api/platform/businesses/[id] — get single business details
// PUT /api/platform/businesses/[id] — update business (suspend, activate, edit)
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requirePlatformAdmin();
    const adminClient = createAdminClient();

    const { data: business, error } = await adminClient
      .from("businesses")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    // Get members with user info
    const { data: members } = await adminClient
      .from("business_members")
      .select("id, role, status, created_at, users!inner(id, username, account_status)")
      .eq("business_id", id)
      .order("role")
      .order("created_at");

    // Get employee count
    const { count: employeeCount } = await adminClient
      .from("employees")
      .select("*", { count: "exact", head: true })
      .eq("business_id", id);

    // Get shift count
    const { count: shiftCount } = await adminClient
      .from("shifts")
      .select("*", { count: "exact", head: true })
      .eq("business_id", id);

    return NextResponse.json({
      ...business,
      members: members || [],
      employee_count: employeeCount || 0,
      shift_count: shiftCount || 0,
    });
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requirePlatformAdmin();
    const adminClient = createAdminClient();

    const body = await request.json();
    const { action } = body;

    // Get the business first
    const { data: business } = await adminClient
      .from("businesses")
      .select("*")
      .eq("id", id)
      .single();

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    if (action === "suspend") {
      const { error } = await adminClient
        .from("businesses")
        .update({ status: "SUSPENDED" })
        .eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, status: "SUSPENDED" });
    }

    if (action === "activate") {
      const { error } = await adminClient
        .from("businesses")
        .update({ status: "ACTIVE" })
        .eq("id", id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, status: "ACTIVE" });
    }

    if (action === "update") {
      const { business_name, email, phone, address, timezone } = body;

      const { data: updated, error } = await adminClient
        .from("businesses")
        .update({
          business_name: business_name ?? business.business_name,
          email: email !== undefined ? (email || null) : business.email,
          phone: phone !== undefined ? (phone || null) : business.phone,
          address: address !== undefined ? (address || null) : business.address,
          timezone: timezone ?? business.timezone,
        })
        .eq("id", id)
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, business: updated });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return handleTenantError(err);
  }
}
