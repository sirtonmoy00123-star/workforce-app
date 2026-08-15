// GET /api/shifts/[id] — get single shift details
// PUT /api/shifts/[id] — update shift (accept/decline by employee, or admin updates)
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
    const { data: shift, error } = await adminClient
      .from("shifts")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !shift) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }

    // Verify access: admin must be same business, employee must own the shift
    if (appUser.role === "admin") {
      if (shift.business_id !== appUser.business_id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else {
      const { data: emp } = await supabase
        .from("employees")
        .select("id")
        .eq("user_id", appUser.id)
        .single();
      if (!emp || shift.employee_id !== emp.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    // Also get employee name for display
    const { data: employee } = await adminClient
      .from("employees")
      .select("full_name, employee_number")
      .eq("id", shift.employee_id)
      .single();

    // Get attendance status if exists
    const { data: attendance } = await adminClient
      .from("shift_attendance")
      .select("attendance_status, actual_start, actual_finish")
      .eq("shift_id", id)
      .eq("employee_id", shift.employee_id)
      .maybeSingle();

    return NextResponse.json({ ...shift, employee, attendance });
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
    if (!appUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await request.json();
    const { action } = body; // "accept" or "decline"

    const adminClient = createAdminClient();

    // Get shift
    const { data: shift } = await adminClient
      .from("shifts")
      .select("*")
      .eq("id", id)
      .single();

    if (!shift) {
      return NextResponse.json({ error: "Shift not found" }, { status: 404 });
    }

    if (appUser.role === "employee") {
      // Employee can only accept/decline their own pending shifts
      const { data: emp } = await supabase
        .from("employees")
        .select("id")
        .eq("user_id", appUser.id)
        .single();

      if (!emp || shift.employee_id !== emp.id) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      if (action === "accept") {
        if (shift.status !== "pending") {
          return NextResponse.json({ error: "Only pending shifts can be accepted." }, { status: 400 });
        }
        const { error } = await adminClient
          .from("shifts")
          .update({ status: "accepted" })
          .eq("id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, status: "accepted" });
      }

      if (action === "decline") {
        if (shift.status !== "pending") {
          return NextResponse.json({ error: "Only pending shifts can be declined." }, { status: 400 });
        }
        const { error } = await adminClient
          .from("shifts")
          .update({ status: "declined" })
          .eq("id", id);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ success: true, status: "declined" });
      }
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
