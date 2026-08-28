// One-time bootstrap: creates the first admin user.
// After running this once, you can delete this file or disable it.
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, fullName } = body;

    if (!email || !password || !fullName) {
      return NextResponse.json(
        { error: "email, password, and fullName are required." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // Check if any admin already exists
    const { data: existingAdmins } = await adminClient
      .from("users")
      .select("*")
      .eq("role", "admin")
      .limit(1);

    if (existingAdmins && existingAdmins.length > 0) {
      return NextResponse.json(
        { error: "An admin user already exists. This endpoint is disabled." },
        { status: 403 }
      );
    }

    // 1. Create the auth user
    const { data: authData, error: authError } =
      await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: authError?.message || "Failed to create auth user." },
        { status: 500 }
      );
    }

    // 2. Create the business row
    const businessId = crypto.randomUUID();
    const slug = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "default";
    const { error: bizError } = await adminClient.from("businesses").insert({
      id: businessId,
      business_name: fullName + "'s Business",
      slug: slug + "-" + businessId.slice(0, 6),
      email,
      status: "ACTIVE",
    });

    if (bizError) {
      return NextResponse.json(
        { error: "Auth user created but business creation failed: " + bizError.message },
        { status: 500 }
      );
    }

    // 3. Create the app user row with role = admin
    const { data: userData, error: userError } = await adminClient.from("users").insert({
      auth_user_id: authData.user.id,
      business_id: businessId,
      role: "admin",
      username: email,
      must_change_password: false,
      account_status: "active",
    }).select("id").single();

    if (userError || !userData) {
      return NextResponse.json(
        { error: "Auth user created but app profile failed: " + userError?.message },
        { status: 500 }
      );
    }

    // 4. Create the business_members row (OWNER)
    const { error: memberError } = await adminClient.from("business_members").insert({
      business_id: businessId,
      user_id: userData.id,
      role: "OWNER",
      status: "ACTIVE",
    });

    if (memberError) {
      return NextResponse.json(
        { error: "User created but membership failed: " + memberError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Admin user created! Log in with email: ${email}`,
      email,
      businessId,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
