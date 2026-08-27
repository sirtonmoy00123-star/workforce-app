// GET /api/attendance/roster?startDate=...&endDate=...
// Returns attendance records keyed by shift_id for the admin roster view.
// Only returns records for shifts in the given date range.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(request: Request) {
  try {
    const ctx = await requireAdmin();
    const url = new URL(request.url);
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");

    if (!startDate || !endDate) {
      return NextResponse.json({ error: "startDate and endDate are required." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Get all shift IDs in the date range for this business
    const { data: shifts } = await adminClient
      .from("shifts")
      .select("id")
      .eq("business_id", ctx.businessId)
      .gte("date", startDate)
      .lte("date", endDate);

    if (!shifts || shifts.length === 0) {
      return NextResponse.json({ records: {} });
    }

    const shiftIds = shifts.map((s) => s.id);

    // Get attendance records for these shifts
    const { data: records } = await adminClient
      .from("attendance_records")
      .select(
        "id, shift_id, employee_id, checkin_status, checkout_status, actual_checkin, actual_checkout, checkin_distance_metres, checkout_distance_metres, verification_status, requires_review"
      )
      .eq("business_id", ctx.businessId)
      .in("shift_id", shiftIds);

    // Key by shift_id for easy lookup
    const recordMap: Record<string, {
      id: string;
      shift_id: string;
      employee_id: string;
      checkin_status: string;
      checkout_status: string;
      actual_checkin: string | null;
      actual_checkout: string | null;
      checkin_distance_metres: number | null;
      checkout_distance_metres: number | null;
      verification_status: string;
      requires_review: boolean;
    }> = {};

    if (records) {
      for (const r of records) {
        recordMap[r.shift_id] = r;
      }
    }

    return NextResponse.json({ records: recordMap });
  } catch (err) {
    return handleTenantError(err);
  }
}
