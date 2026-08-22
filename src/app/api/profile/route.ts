// GET /api/profile — get current employee's profile
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, handleTenantError } from "@/lib/services/tenantContext";

export async function GET() {
  try {
    const ctx = await requireRole("EMPLOYEE");

    if (!ctx.employeeId) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const adminClient = createAdminClient();

    const { data: employee, error } = await adminClient
      .from("employees")
      .select("full_name, employee_number, phone, hourly_rate, mileage_rate, employment_status, odometer_tracking_enabled, task_proof_enabled")
      .eq("id", ctx.employeeId)
      .eq("business_id", ctx.businessId)
      .single();

    if (error || !employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    return NextResponse.json(employee);
  } catch (err) {
    return handleTenantError(err);
  }
}
