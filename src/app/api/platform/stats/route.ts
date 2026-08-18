// GET /api/platform/stats — platform-wide statistics
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET() {
  try {
    await requirePlatformAdmin();
    const adminClient = createAdminClient();

    const { count: totalBusinesses } = await adminClient
      .from("businesses")
      .select("*", { count: "exact", head: true });

    const { count: activeBusinesses } = await adminClient
      .from("businesses")
      .select("*", { count: "exact", head: true })
      .eq("status", "ACTIVE");

    const { count: suspendedBusinesses } = await adminClient
      .from("businesses")
      .select("*", { count: "exact", head: true })
      .eq("status", "SUSPENDED");

    const { count: totalUsers } = await adminClient
      .from("users")
      .select("*", { count: "exact", head: true });

    const { count: totalEmployees } = await adminClient
      .from("employees")
      .select("*", { count: "exact", head: true });

    const { count: totalShifts } = await adminClient
      .from("shifts")
      .select("*", { count: "exact", head: true });

    return NextResponse.json({
      totalBusinesses: totalBusinesses || 0,
      activeBusinesses: activeBusinesses || 0,
      suspendedBusinesses: suspendedBusinesses || 0,
      totalUsers: totalUsers || 0,
      totalEmployees: totalEmployees || 0,
      totalShifts: totalShifts || 0,
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
