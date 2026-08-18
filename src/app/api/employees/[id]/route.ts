// GET /api/employees/[id] — get single employee
// PUT /api/employees/[id] — update employee details
// POST /api/employees/[id] — special actions (disable, enable, reset-password)
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();

    const { data: employee, error } = await adminClient
      .from("employees")
      .select("*")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (error || !employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    // Also get the user record for status info
    const { data: userRecord } = await adminClient
      .from("users")
      .select("*")
      .eq("id", employee.user_id)
      .single();

    return NextResponse.json({ ...employee, userRecord });
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
    const ctx = await requireAdmin();

    const body = await request.json();
    const { fullName, phone, hourlyRate, mileageRate } = body;

    const adminClient = createAdminClient();
    const { data: employee, error } = await adminClient
      .from("employees")
      .update({
        full_name: fullName,
        phone: phone || null,
        hourly_rate: parseFloat(hourlyRate) || 0,
        mileage_rate: parseFloat(mileageRate) || 0,
      })
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(employee);
  } catch (err) {
    return handleTenantError(err);
  }
}

// POST for special actions: disable, enable, reset-password
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireAdmin();

    const body = await request.json();
    const { action, newPassword } = body;

    const adminClient = createAdminClient();

    // Get employee + their user record
    const { data: employee } = await adminClient
      .from("employees")
      .select("*")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const { data: userRecord } = await adminClient
      .from("users")
      .select("*")
      .eq("id", employee.user_id)
      .single();

    if (!userRecord) {
      return NextResponse.json({ error: "User record not found" }, { status: 404 });
    }

    switch (action) {
      case "disable": {
        await adminClient
          .from("users")
          .update({ account_status: "disabled" })
          .eq("id", userRecord.id);
        await adminClient
          .from("employees")
          .update({ employment_status: "inactive" })
          .eq("id", id);
        return NextResponse.json({ success: true, message: "Employee disabled." });
      }

      case "enable": {
        await adminClient
          .from("users")
          .update({ account_status: "active" })
          .eq("id", userRecord.id);
        await adminClient
          .from("employees")
          .update({ employment_status: "active" })
          .eq("id", id);
        return NextResponse.json({ success: true, message: "Employee reactivated." });
      }

      case "reset-password": {
        if (!newPassword || newPassword.length < 6) {
          return NextResponse.json(
            { error: "New password must be at least 6 characters." },
            { status: 400 }
          );
        }
        await adminClient.auth.admin.updateUserById(userRecord.auth_user_id, {
          password: newPassword,
        });
        await adminClient
          .from("users")
          .update({ must_change_password: true })
          .eq("id", userRecord.id);
        return NextResponse.json({
          success: true,
          message: "Password reset. Employee must change it on next login.",
        });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return handleTenantError(err);
  }
}
