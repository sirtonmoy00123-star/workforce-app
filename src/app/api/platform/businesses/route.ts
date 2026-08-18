// GET /api/platform/businesses — list all businesses
// POST /api/platform/businesses — create a new business + its first owner
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET() {
  try {
    await requirePlatformAdmin();
    const adminClient = createAdminClient();

    // Get all businesses with member counts
    const { data: businesses, error } = await adminClient
      .from("businesses")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Get member counts and owner info for each business
    const result = await Promise.all(
      (businesses || []).map(async (biz) => {
        const { count: memberCount } = await adminClient
          .from("business_members")
          .select("*", { count: "exact", head: true })
          .eq("business_id", biz.id)
          .eq("status", "ACTIVE");

        const { data: owner } = await adminClient
          .from("business_members")
          .select("user_id, users!inner(username)")
          .eq("business_id", biz.id)
          .eq("role", "OWNER")
          .limit(1)
          .single();

        return {
          ...biz,
          member_count: memberCount || 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          owner_username: (owner as any)?.users?.username || null,
        };
      })
    );

    return NextResponse.json(result);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function POST(request: Request) {
  try {
    await requirePlatformAdmin();

    const body = await request.json();
    const {
      business_name,
      slug,
      email,
      phone,
      address,
      timezone,
      // Owner details
      owner_email,
      owner_password,
      owner_name,
    } = body;

    // Validate required fields
    if (!business_name || !slug || !owner_email || !owner_password || !owner_name) {
      return NextResponse.json(
        { error: "Business name, slug, owner email, owner password, and owner name are required." },
        { status: 400 }
      );
    }

    // Validate slug format
    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) && slug.length > 1) {
      return NextResponse.json(
        { error: "Slug must contain only lowercase letters, numbers, and hyphens." },
        { status: 400 }
      );
    }

    if (owner_password.length < 6) {
      return NextResponse.json(
        { error: "Owner password must be at least 6 characters." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // Check slug uniqueness
    const { data: existingBiz } = await adminClient
      .from("businesses")
      .select("id")
      .eq("slug", slug)
      .limit(1);

    if (existingBiz && existingBiz.length > 0) {
      return NextResponse.json(
        { error: `Slug "${slug}" is already taken. Choose another.` },
        { status: 400 }
      );
    }

    // 1. Create the business
    const { data: business, error: bizError } = await adminClient
      .from("businesses")
      .insert({
        business_name,
        slug,
        email: email || null,
        phone: phone || null,
        address: address || null,
        timezone: timezone || "Australia/Sydney",
        currency: "AUD",
        week_starts_on: 1, // Monday
        status: "ACTIVE",
      })
      .select()
      .single();

    if (bizError || !business) {
      return NextResponse.json(
        { error: "Failed to create business: " + (bizError?.message || "Unknown error") },
        { status: 500 }
      );
    }

    // 2. Create the Supabase Auth user for the owner
    const { data: authData, error: authError } =
      await adminClient.auth.admin.createUser({
        email: owner_email,
        password: owner_password,
        email_confirm: true,
      });

    if (authError || !authData.user) {
      // Rollback business
      await adminClient.from("businesses").delete().eq("id", business.id);
      return NextResponse.json(
        { error: "Failed to create owner auth account: " + (authError?.message || "Unknown") },
        { status: 500 }
      );
    }

    // 3. Create the app user row
    const { data: newUser, error: userError } = await adminClient
      .from("users")
      .insert({
        auth_user_id: authData.user.id,
        business_id: business.id,
        role: "admin",
        username: owner_email,
        must_change_password: false,
        account_status: "active",
        is_platform_admin: false,
      })
      .select()
      .single();

    if (userError || !newUser) {
      // Rollback
      await adminClient.auth.admin.deleteUser(authData.user.id);
      await adminClient.from("businesses").delete().eq("id", business.id);
      return NextResponse.json(
        { error: "Failed to create owner user profile: " + (userError?.message || "Unknown") },
        { status: 500 }
      );
    }

    // 4. Create business_members row (OWNER)
    const { error: memberError } = await adminClient
      .from("business_members")
      .insert({
        business_id: business.id,
        user_id: newUser.id,
        role: "OWNER",
        status: "ACTIVE",
      });

    if (memberError) {
      // Rollback
      await adminClient.from("users").delete().eq("id", newUser.id);
      await adminClient.auth.admin.deleteUser(authData.user.id);
      await adminClient.from("businesses").delete().eq("id", business.id);
      return NextResponse.json(
        { error: "Failed to create owner membership: " + memberError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      business: {
        id: business.id,
        business_name: business.business_name,
        slug: business.slug,
        status: business.status,
      },
      owner: {
        email: owner_email,
        name: owner_name,
        note: "Owner can now log in and start adding employees.",
      },
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
