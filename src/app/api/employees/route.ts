// GET /api/employees — list employees for the admin's business
// POST /api/employees — create a new employee (auth user + employees row)
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET() {
  try {
    const ctx = await requireAdmin();

    const adminClient = createAdminClient();
    const { data: employees, error } = await adminClient
      .from("employees")
      .select("*")
      .eq("business_id", ctx.businessId)
      .order("full_name");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(employees);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();

    const body = await request.json();
    const { fullName, phone, employeeNumber, hourlyRate, mileageRate, userId, temporaryPassword, odometerTrackingEnabled, taskProofEnabled } = body;

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
      .eq("business_id", ctx.businessId)
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
        business_id: ctx.businessId,
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

    // 2b. Create business_members row for the new employee
    await adminClient
      .from("business_members")
      .insert({
        business_id: ctx.businessId,
        user_id: newUser.id,
        role: "EMPLOYEE",
        status: "ACTIVE",
      });

    // 3. Create employee row
    const { data: employee, error: empError } = await adminClient
      .from("employees")
      .insert({
        business_id: ctx.businessId,
        user_id: newUser.id,
        employee_number: employeeNumber,
        full_name: fullName,
        phone: phone || null,
        hourly_rate: parseFloat(hourlyRate) || 0,
        mileage_rate: parseFloat(mileageRate) || 0,
        employment_status: "active",
        odometer_tracking_enabled: odometerTrackingEnabled !== false,
        task_proof_enabled: !!taskProofEnabled,
      })
      .select("*")
      .single();

    if (empError) {
      // Rollback: delete user row and auth user
      await adminClient.from("business_members").delete().eq("user_id", newUser.id);
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
  } catch (err) {
    return handleTenantError(err);
  }
}
