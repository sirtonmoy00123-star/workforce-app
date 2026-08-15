// GET /api/payments/[id] — get single payment
// PUT /api/payments/[id] — mark as paid
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

    const { data: payment, error } = await adminClient
      .from("payments")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    // Get employee info
    const { data: employee } = await adminClient
      .from("employees")
      .select("id, full_name, employee_number, business_id")
      .eq("id", payment.employee_id)
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
      if (!emp || payment.employee_id !== emp.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    return NextResponse.json({
      ...payment,
      employee: employee ? { full_name: employee.full_name, employee_number: employee.employee_number } : null,
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
      return NextResponse.json({ error: "Only admins can mark payments." }, { status: 403 });
    }

    const body = await request.json();
    const { action } = body; // "mark_paid"

    const adminClient = createAdminClient();

    const { data: payment } = await adminClient
      .from("payments")
      .select("*")
      .eq("id", id)
      .single();

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    // Verify employee is in admin's business
    const { data: employee } = await adminClient
      .from("employees")
      .select("business_id")
      .eq("id", payment.employee_id)
      .single();

    if (!employee || employee.business_id !== appUser.business_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (action === "mark_paid") {
      if (payment.status === "paid") {
        return NextResponse.json({ error: "Payment is already marked as paid." }, { status: 400 });
      }

      const { error } = await adminClient
        .from("payments")
        .update({
          status: "paid",
          payment_date: new Date().toISOString().split("T")[0],
          marked_paid_by: appUser.id,
        })
        .eq("id", id);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, status: "paid" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
