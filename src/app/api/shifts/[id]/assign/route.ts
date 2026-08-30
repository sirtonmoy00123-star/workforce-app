// POST /api/shifts/[id]/assign — assign an employee to an unfilled shift
// GET /api/shifts/[id]/assign — find available employees for an unfilled shift
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";
import {
  validateShiftAssignment,
  type ShiftAssignmentInput,
  type EmployeeData,
  type ExistingShiftData,
} from "@/lib/services/shiftValidation";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();

    // Get the shift
    const { data: shift } = await adminClient
      .from("shifts")
      .select("*")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!shift) {
      return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    }

    // Get all active employees in the business
    const { data: employees } = await adminClient
      .from("employees")
      .select("id, business_id, full_name, employee_number, employment_status, hourly_rate")
      .eq("business_id", ctx.businessId)
      .eq("employment_status", "active");

    if (!employees || employees.length === 0) {
      return NextResponse.json({ available: [] });
    }

    const shiftDate = new Date(shift.date);
    const dayOfWeek = shiftDate.getDay();
    const employeeIds = employees.map((e) => e.id);

    // Fetch availability, existing shifts, and leave in parallel
    const prevDay = new Date(new Date(shift.date + "T12:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
    const nextDay = new Date(new Date(shift.date + "T12:00:00Z").getTime() + 86400000).toISOString().slice(0, 10);

    const [availResult, shiftsResult, leaveResult] = await Promise.all([
      adminClient
        .from("employee_availability")
        .select("*")
        .in("employee_id", employeeIds)
        .eq("day_of_week", dayOfWeek),
      adminClient
        .from("shifts")
        .select("id, employee_id, date, scheduled_start, scheduled_finish, status, location_id")
        .in("employee_id", employeeIds)
        .gte("date", prevDay)
        .lte("date", nextDay)
        .not("status", "in", '("cancelled","declined")'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (adminClient as any)
        .from("employee_leave")
        .select("employee_id, leave_type, start_date, end_date, status")
        .in("employee_id", employeeIds)
        .eq("status", "APPROVED")
        .lte("start_date", shift.date)
        .gte("end_date", shift.date),
    ]);

    const availabilities = availResult.data || [];
    const existingShifts: ExistingShiftData[] = shiftsResult.data || [];
    const approvedLeave = leaveResult.data || [];

    // Validate each employee against the shift
    const startTime = new Date(shift.scheduled_start).toISOString().slice(11, 16);
    const endTime = new Date(shift.scheduled_finish).toISOString().slice(11, 16);

    const available: {
      employeeId: string;
      fullName: string;
      employeeNumber: string;
      hourlyRate: number | null;
      issues: { type: string; message: string; severity: string }[];
    }[] = [];

    for (const emp of employees) {
      const input: ShiftAssignmentInput = {
        employeeId: emp.id,
        businessId: ctx.businessId,
        date: shift.date,
        startTime,
        endTime,
        location: shift.location || undefined,
      };

      const employeeData: EmployeeData = {
        id: emp.id,
        business_id: emp.business_id,
        full_name: emp.full_name,
        employment_status: emp.employment_status,
      };

      const avail = availabilities.find((a: { employee_id: string }) => a.employee_id === emp.id) || null;
      const empShifts = existingShifts.filter((s) => s.employee_id === emp.id);
      const empLeave = approvedLeave.filter((l: { employee_id: string }) => l.employee_id === emp.id);

      const result = validateShiftAssignment(input, employeeData, avail, empShifts, empLeave);

      // Include employee with their issues (errors make them unavailable, warnings are ok)
      const allIssues = [
        ...result.errors.map((e) => ({ type: e.type, message: e.message, severity: "error" })),
        ...result.warnings.map((w) => ({ type: w.type, message: w.message, severity: "warning" })),
      ];

      available.push({
        employeeId: emp.id,
        fullName: emp.full_name,
        employeeNumber: emp.employee_number,
        hourlyRate: emp.hourly_rate,
        issues: allIssues,
      });
    }

    // Sort: employees with no issues first, then warnings, then errors
    available.sort((a, b) => {
      const aErrors = a.issues.filter((i) => i.severity === "error").length;
      const bErrors = b.issues.filter((i) => i.severity === "error").length;
      if (aErrors !== bErrors) return aErrors - bErrors;
      return a.issues.length - b.issues.length;
    });

    return NextResponse.json({ available });
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();
    const body = await request.json();

    const { employeeId, overrideWarnings } = body;

    if (!employeeId) {
      return NextResponse.json({ error: "Employee ID is required." }, { status: 400 });
    }

    // Get the shift
    const { data: shift } = await adminClient
      .from("shifts")
      .select("*")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!shift) {
      return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    }

    // Verify employee
    const { data: emp } = await adminClient
      .from("employees")
      .select("*")
      .eq("id", employeeId)
      .eq("business_id", ctx.businessId)
      .single();

    if (!emp) {
      return NextResponse.json({ error: "Employee not found." }, { status: 404 });
    }

    // Run validation
    const startTime = new Date(shift.scheduled_start).toISOString().slice(11, 16);
    const endTime = new Date(shift.scheduled_finish).toISOString().slice(11, 16);

    const input: ShiftAssignmentInput = {
      employeeId,
      businessId: ctx.businessId,
      date: shift.date,
      startTime,
      endTime,
      location: shift.location || undefined,
    };

    const employeeData: EmployeeData = {
      id: emp.id,
      business_id: emp.business_id,
      full_name: emp.full_name,
      employment_status: emp.employment_status,
    };

    // Fetch validation data
    const shiftDate = new Date(shift.date);
    const dayOfWeek = shiftDate.getDay();
    const prevDay = new Date(new Date(shift.date + "T12:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
    const nextDay = new Date(new Date(shift.date + "T12:00:00Z").getTime() + 86400000).toISOString().slice(0, 10);

    const [availResult, shiftsResult, leaveResult] = await Promise.all([
      adminClient
        .from("employee_availability")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("day_of_week", dayOfWeek)
        .single(),
      adminClient
        .from("shifts")
        .select("id, employee_id, date, scheduled_start, scheduled_finish, status, location_id")
        .eq("employee_id", employeeId)
        .gte("date", prevDay)
        .lte("date", nextDay)
        .not("status", "in", '("cancelled","declined")'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (adminClient as any)
        .from("employee_leave")
        .select("id, leave_type, start_date, end_date, status")
        .eq("employee_id", employeeId)
        .eq("status", "APPROVED")
        .lte("start_date", shift.date)
        .gte("end_date", shift.date),
    ]);

    const result = validateShiftAssignment(
      input,
      employeeData,
      availResult.data || null,
      (shiftsResult.data || []) as ExistingShiftData[],
      leaveResult.data || [],
    );

    if (result.errors.length > 0) {
      return NextResponse.json(
        { error: result.errors[0].message, issues: result.errors },
        { status: 400 }
      );
    }

    if (result.warnings.length > 0 && !overrideWarnings) {
      return NextResponse.json(
        {
          warning: true,
          message: result.warnings.map((w) => w.message).join(" "),
          issues: result.warnings,
        },
        { status: 409 }
      );
    }

    // Assign employee to the shift
    const { data: updated, error } = await adminClient
      .from("shifts")
      .update({
        employee_id: employeeId,
        hourly_rate_snapshot: emp.hourly_rate,
        mileage_rate_snapshot: emp.mileage_rate,
        status: "pending" as const,
      })
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, shift: updated });
  } catch (err) {
    return handleTenantError(err);
  }
}
