// GET /api/timesheets/[id] — get single timesheet details
// PUT /api/timesheets/[id] — admin approve/needs_correction
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
    if (!appUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const adminClient = createAdminClient();

    const { data: timesheet, error } = await adminClient
      .from("timesheets")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !timesheet) {
      return NextResponse.json({ error: "Timesheet not found" }, { status: 404 });
    }

    // Get employee info
    const { data: employee } = await adminClient
      .from("employees")
      .select("id, full_name, employee_number, business_id")
      .eq("id", timesheet.employee_id)
      .single();

    // Verify access
    if (appUser.role === "admin") {
      if (employee && employee.business_id !== appUser.business_id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      const { data: emp } = await supabase
        .from("employees")
        .select("id")
        .eq("user_id", appUser.id)
        .single();
      if (!emp || timesheet.employee_id !== emp.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Get odometer submissions for this shift
    const { data: odometerSubmissions } = await adminClient
      .from("odometer_submissions")
      .select("*")
      .eq("shift_id", timesheet.shift_id)
      .order("server_timestamp", { ascending: true });

    // Get shift info
    const { data: shift } = await adminClient
      .from("shifts")
      .select("location, instructions")
      .eq("id", timesheet.shift_id)
      .single();

    return NextResponse.json({
      ...timesheet,
      employee: employee ? { full_name: employee.full_name, employee_number: employee.employee_number } : null,
      odometer_submissions: odometerSubmissions || [],
      shift_location: shift?.location || null,
    });
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
      return NextResponse.json({ error: "Only admins can approve timesheets." }, { status: 403 });
    }

    const body = await request.json();
    const { action, approved_total } = body; // action: "approve" | "needs_correction"

    const adminClient = createAdminClient();

    const { data: timesheet } = await adminClient
      .from("timesheets")
      .select("*, employees!inner(business_id)")
      .eq("id", id)
      .single();

    if (!timesheet) {
      return NextResponse.json({ error: "Timesheet not found" }, { status: 404 });
    }

    // Use a simpler check — get the employee's business_id
    const { data: employee } = await adminClient
      .from("employees")
      .select("business_id")
      .eq("id", timesheet.employee_id)
      .single();

    if (!employee || employee.business_id !== appUser.business_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (action === "approve") {
      const finalTotal = approved_total !== undefined ? approved_total : timesheet.estimated_total;

      const { error } = await adminClient
        .from("timesheets")
        .update({
          status: "approved",
          approved_total: finalTotal,
          approved_by: appUser.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, status: "approved" });
    }

    if (action === "needs_correction") {
      const { error } = await adminClient
        .from("timesheets")
        .update({
          status: "needs_correction",
          approved_by: appUser.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", id);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, status: "needs_correction" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
