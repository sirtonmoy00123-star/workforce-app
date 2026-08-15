// GET /api/employees — list employees for the admin's business
// POST /api/employees — create a new employee (auth user + employees row)
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    // Get admin's business_id
    const { data: appUser } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", user.id)
      .single();

    if (!appUser || appUser.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: employees, error } = await supabase
      .from("employees")
      .select("*")
      .eq("business_id", appUser.business_id)
      .order("full_name");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(employees);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    // Verify admin role
    const { data: appUser } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", user.id)
      .single();

    if (!appUser || appUser.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { fullName, phone, employeeNumber, hourlyRate, mileageRate, userId, temporaryPassword } = body;

    // Validation
    if (!fullName || !employeeNumber || !userId || !temporaryPassword) {
      return NextResponse.json(
        { error: "Full name, employee number, user ID, and temporary password are required." },
        { status: 400 }
      );
    }

    if (temporaryPassword.length < 6) {
      return NextResponse.json(
        { error: "Temporary password must be at least 6 characters." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // Check for duplicate employee number in same business
    const { data: existing } = await adminClient
      .from("employees")
      .select("id")
      .eq("business_id", appUser.business_id)
      .eq("employee_number", employeeNumber)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: `Employee number "${employeeNumber}" already exists.` },
        { status: 400 }
      );
    }

    // 1. Create Supabase Auth user
    // We use userId@workforce.app as the email so employees log in with their simple User ID
    const email = userId.includes("@") ? userId : `${userId}@workforce.app`;

    const { data: authData, error: authError } =
      await adminClient.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
      });

    if (authError || !authData.user) {
      return NextResponse.json(
        { error: authError?.message || "Failed to create auth user." },
        { status: 500 }
      );
    }

    // 2. Create app user row (role = employee, must_change_password = true)
    const { data: newUser, error: userError } = await adminClient
      .from("users")
      .insert({
        auth_user_id: authData.user.id,
        business_id: appUser.business_id,
        role: "employee",
        username: userId,
        must_change_password: true,
        account_status: "active",
      })
      .select("*")
      .single();

    if (userError || !newUser) {
      // Rollback: delete the auth user
      await adminClient.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json(
        { error: "Failed to create user profile: " + (userError?.message || "Unknown error") },
        { status: 500 }
      );
    }

    // 3. Create employee row
    const { data: employee, error: empError } = await adminClient
      .from("employees")
      .insert({
        business_id: appUser.business_id,
        user_id: newUser.id,
        employee_number: employeeNumber,
        full_name: fullName,
        phone: phone || null,
        hourly_rate: parseFloat(hourlyRate) || 0,
        mileage_rate: parseFloat(mileageRate) || 0,
        employment_status: "active",
      })
      .select("*")
      .single();

    if (empError) {
      // Rollback: delete user row and auth user
      await adminClient.from("users").delete().eq("id", newUser.id);
      await adminClient.auth.admin.deleteUser(authData.user.id);
      return NextResponse.json(
        { error: "Failed to create employee: " + empError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      employee,
      loginInfo: {
        userId,
        temporaryPassword,
        note: "Employee must change password on first login.",
      },
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
