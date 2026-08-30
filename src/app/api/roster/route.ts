// GET /api/roster — list roster weeks
// POST /api/roster — create or get a roster week
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(request: Request) {
  try {
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();
    const url = new URL(request.url);

    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const status = url.searchParams.get("status");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (adminClient as any)
      .from("roster_weeks")
      .select("*")
      .eq("business_id", ctx.businessId)
      .order("week_start", { ascending: false });

    if (startDate) query = query.gte("week_start", startDate);
    if (endDate) query = query.lte("week_start", endDate);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data || []);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();
    const body = await request.json();

    const { weekStart } = body;

    if (!weekStart) {
      return NextResponse.json({ error: "weekStart is required (YYYY-MM-DD, must be a Monday)." }, { status: 400 });
    }

    // Validate it's a Monday
    const d = new Date(weekStart + "T12:00:00Z");
    if (d.getUTCDay() !== 1) {
      return NextResponse.json({ error: "weekStart must be a Monday." }, { status: 400 });
    }

    // Calculate week end (Sunday)
    const weekEnd = new Date(d);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const weekEndStr = weekEnd.toISOString().slice(0, 10);

    // Upsert — get existing or create new
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing } = await (adminClient as any)
      .from("roster_weeks")
      .select("*")
      .eq("business_id", ctx.businessId)
      .eq("week_start", weekStart)
      .single();

    if (existing) {
      // Return existing roster week with shift stats
      const stats = await getRosterWeekStats(adminClient, ctx.businessId, weekStart, weekEndStr);
      return NextResponse.json({ ...existing, ...stats });
    }

    // Create new roster week
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rosterWeek, error } = await (adminClient as any)
      .from("roster_weeks")
      .insert({
        business_id: ctx.businessId,
        week_start: weekStart,
        week_end: weekEndStr,
        status: "DRAFT",
      })
      .select("*")
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const stats = await getRosterWeekStats(adminClient, ctx.businessId, weekStart, weekEndStr);
    return NextResponse.json({ ...rosterWeek, ...stats });
  } catch (err) {
    return handleTenantError(err);
  }
}

// Helper: compute roster week stats from shifts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getRosterWeekStats(adminClient: any, businessId: string, weekStart: string, weekEnd: string) {
  const { data: shifts } = await adminClient
    .from("shifts")
    .select("id, employee_id, date, scheduled_start, scheduled_finish, status")
    .eq("business_id", businessId)
    .gte("date", weekStart)
    .lte("date", weekEnd)
    .not("status", "in", '("cancelled","declined")');

  const allShifts = shifts || [];
  const totalShifts = allShifts.length;
  const unfilledShifts = allShifts.filter((s: { employee_id: string | null }) => !s.employee_id).length;
  const draftShifts = allShifts.filter((s: { status: string }) => s.status === "draft").length;

  // Unique employees
  const employeeIds = new Set(
    allShifts
      .filter((s: { employee_id: string | null }) => s.employee_id)
      .map((s: { employee_id: string }) => s.employee_id)
  );

  // Total hours
  let totalHours = 0;
  for (const s of allShifts) {
    const start = new Date(s.scheduled_start).getTime();
    const finish = new Date(s.scheduled_finish).getTime();
    totalHours += (finish - start) / (1000 * 60 * 60);
  }

  // Estimated cost (would need rate info, use shift rate snapshots if available)
  // For now return 0 — will be calculated properly when we have rate snapshots on all shifts
  return {
    stats: {
      totalShifts,
      unfilledShifts,
      draftShifts,
      employeesScheduled: employeeIds.size,
      totalHours: Math.round(totalHours * 100) / 100,
    },
  };
}
