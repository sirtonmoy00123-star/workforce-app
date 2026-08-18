// GET /api/employees/[id]/availability — get weekly availability
// PUT /api/employees/[id]/availability — set/update weekly availability (all 7 days)
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { data: appUser } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", user.id)
      .single();

    if (!appUser || appUser.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Verify employee belongs to this business
    const { data: employee } = await supabase
      .from("employees")
      .select("*")
      .eq("id", id)
      .eq("business_id", appUser.business_id)
      .single();

    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const { data: availability, error } = await supabase
      .from("employee_availability")
      .select("*")
      .eq("employee_id", id)
      .order("day_of_week");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(availability || []);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { data: appUser } = await supabase
      .from("users")
      .select("*")
      .eq("auth_user_id", user.id)
      .single();

    if (!appUser || appUser.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Verify employee belongs to this business
    const { data: employee } = await supabase
      .from("employees")
      .select("*")
      .eq("id", id)
      .eq("business_id", appUser.business_id)
      .single();

    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const body = await request.json();
    const { days } = body;
    // days is an array of 7 entries: [{ dayOfWeek: 0, isAvailable: bool, startTime: "HH:MM", endTime: "HH:MM" }, ...]

    if (!Array.isArray(days) || days.length !== 7) {
      return NextResponse.json(
        { error: "Must provide availability for all 7 days." },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // Delete existing availability for this employee, then insert fresh
    await adminClient
      .from("employee_availability")
      .delete()
      .eq("employee_id", id);

    const rows = days.map((day: { dayOfWeek: number; isAvailable: boolean; startTime: string | null; endTime: string | null }) => ({
      employee_id: id,
      business_id: appUser.business_id,
      day_of_week: day.dayOfWeek,
      is_available: day.isAvailable,
      start_time: day.isAvailable ? day.startTime : null,
      end_time: day.isAvailable ? day.endTime : null,
      created_by: appUser.id,
    }));

    const { error } = await adminClient
      .from("employee_availability")
      .insert(rows);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
