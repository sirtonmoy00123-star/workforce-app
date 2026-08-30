// GET /api/leave — list leave records (admin: all in business, employee: own)
// POST /api/leave — create a leave request (employee or admin)
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(request: Request) {
  try {
    const ctx = await requireMember();
    const adminClient = createAdminClient();
    const url = new URL(request.url);

    const employeeId = url.searchParams.get("employeeId");
    const status = url.searchParams.get("status");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (adminClient as any)
      .from("employee_leave")
      .select("*, employees ( full_name, employee_number )")
      .eq("business_id", ctx.businessId)
      .order("start_date", { ascending: false });

    // Employee can only see their own leave
    if (ctx.role === "EMPLOYEE") {
      if (!ctx.employeeId) return NextResponse.json([]);
      query = query.eq("employee_id", ctx.employeeId);
    } else if (employeeId) {
      query = query.eq("employee_id", employeeId);
    }

    if (status) query = query.eq("status", status);
    if (startDate) query = query.gte("end_date", startDate);
    if (endDate) query = query.lte("start_date", endDate);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json(data || []);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireMember();
    const adminClient = createAdminClient();
    const body = await request.json();

    const { employeeId, leaveType, startDate, endDate, employeeNote } = body;

    // Determine the target employee
    let targetEmployeeId: string;

    if (ctx.role === "EMPLOYEE") {
      // Employees can only request leave for themselves
      if (!ctx.employeeId) {
        return NextResponse.json({ error: "Employee record not found." }, { status: 404 });
      }
      targetEmployeeId = ctx.employeeId;
    } else {
      // Admin can create leave for any employee in their business
      if (!employeeId) {
        return NextResponse.json({ error: "Employee ID is required." }, { status: 400 });
      }
      // Verify employee is in the same business
      const { data: emp } = await adminClient
        .from("employees")
        .select("id")
        .eq("id", employeeId)
        .eq("business_id", ctx.businessId)
        .single();
      if (!emp) {
        return NextResponse.json({ error: "Employee not found." }, { status: 404 });
      }
      targetEmployeeId = employeeId;
    }

    // Validate required fields
    if (!leaveType || !startDate || !endDate) {
      return NextResponse.json({ error: "Leave type, start date, and end date are required." }, { status: 400 });
    }

    const validTypes = ["ANNUAL", "SICK", "PERSONAL", "UNPAID", "OTHER"];
    if (!validTypes.includes(leaveType)) {
      return NextResponse.json({ error: `Invalid leave type. Must be one of: ${validTypes.join(", ")}` }, { status: 400 });
    }

    if (endDate < startDate) {
      return NextResponse.json({ error: "End date must be on or after start date." }, { status: 400 });
    }

    // Check for overlapping approved leave
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: overlapping } = await (adminClient as any)
      .from("employee_leave")
      .select("id, leave_type, start_date, end_date")
      .eq("employee_id", targetEmployeeId)
      .in("status", ["PENDING", "APPROVED"])
      .lte("start_date", endDate)
      .gte("end_date", startDate);

    if (overlapping && overlapping.length > 0) {
      return NextResponse.json({
        error: "Overlapping leave already exists for this period.",
        overlapping,
      }, { status: 409 });
    }

    // Admin-created leave can be auto-approved
    const initialStatus = ctx.role === "EMPLOYEE" ? "PENDING" : "APPROVED";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: leave, error } = await (adminClient as any)
      .from("employee_leave")
      .insert({
        business_id: ctx.businessId,
        employee_id: targetEmployeeId,
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        status: initialStatus,
        employee_note: employeeNote || null,
        reviewed_by: ctx.role !== "EMPLOYEE" ? ctx.userId : null,
        reviewed_at: ctx.role !== "EMPLOYEE" ? new Date().toISOString() : null,
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, leave });
  } catch (err) {
    return handleTenantError(err);
  }
}
