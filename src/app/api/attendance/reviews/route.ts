// GET /api/attendance/reviews — list attendance records for admin review
//
// Query params:
//   filter    — "needs_review" (default) | "all"
//   date      — YYYY-MM-DD (optional, filters by shift date)
//   page      — pagination (1-based, default 1)
//   limit     — items per page (default 20)

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(request: Request) {
  try {
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();

    const url = new URL(request.url);
    const filter = url.searchParams.get("filter") || "needs_review";
    const date = url.searchParams.get("date");
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "20")));
    const offset = (page - 1) * limit;

    // Build query — join with employees for names
    let query = adminClient
      .from("attendance_records")
      .select(
        `
        id,
        shift_id,
        employee_id,
        location_id,
        scheduled_start,
        scheduled_finish,
        actual_checkin,
        actual_checkout,
        approved_start,
        approved_finish,
        checkin_status,
        checkout_status,
        qr_mode,
        qr_verified,
        checkin_distance_metres,
        selfie_photo_path,
        site_photo_path,
        verification_status,
        requires_review,
        reviewed_by,
        reviewed_at,
        review_note,
        created_at,
        updated_at,
        employees!inner ( id, full_name, employee_number ),
        work_locations ( id, name ),
        shifts!inner ( id, date, location )
        `,
        { count: "exact" }
      )
      .eq("business_id", ctx.businessId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // Filter
    if (filter === "needs_review") {
      query = query.eq("requires_review", true).eq("verification_status", "NEEDS_REVIEW");
    }

    if (date) {
      query = query.eq("shifts.date", date);
    }

    const { data: records, error, count } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // For each record, fetch its exceptions
    const recordIds = (records || []).map((r: Record<string, unknown>) => r.id as string);
    let exceptions: Record<string, unknown>[] = [];
    if (recordIds.length > 0) {
      const { data: excs } = await adminClient
        .from("attendance_exceptions")
        .select("*")
        .eq("business_id", ctx.businessId)
        .in("attendance_record_id", recordIds);
      exceptions = excs || [];
    }

    // Group exceptions by record id
    const exceptionsByRecord: Record<string, Record<string, unknown>[]> = {};
    for (const exc of exceptions) {
      const rid = exc.attendance_record_id as string;
      if (!exceptionsByRecord[rid]) exceptionsByRecord[rid] = [];
      exceptionsByRecord[rid].push(exc);
    }

    // Attach exceptions to records
    const enrichedRecords = (records || []).map((r: Record<string, unknown>) => ({
      ...r,
      exceptions: exceptionsByRecord[r.id as string] || [],
    }));

    return NextResponse.json({
      records: enrichedRecords,
      total: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
