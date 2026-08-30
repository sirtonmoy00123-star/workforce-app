// POST /api/roster/[id]/publish — validate and publish all draft shifts in a roster week
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";
import {
  validateShiftAssignment,
  type ShiftAssignmentInput,
  type EmployeeData,
  type ExistingShiftData,
  type ValidationIssue,
} from "@/lib/services/shiftValidation";
import { shiftAudit } from "@/lib/services/auditService";

interface ShiftValidationResult {
  shiftId: string;
  employeeName: string;
  date: string;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();
    const body = await request.json().catch(() => ({}));
    const { overrideWarnings } = body;

    // 1. Fetch the roster week
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rosterWeek } = await (adminClient as any)
      .from("roster_weeks")
      .select("*")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!rosterWeek) {
      return NextResponse.json({ error: "Roster week not found." }, { status: 404 });
    }

    if (rosterWeek.status === "PUBLISHED") {
      return NextResponse.json({ error: "Roster week is already published." }, { status: 400 });
    }

    // 2. Get all draft shifts for this week
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: draftShifts } = await (adminClient as any)
      .from("shifts")
      .select("*, employees ( id, full_name, employee_number, employment_status, business_id )")
      .eq("business_id", ctx.businessId)
      .gte("date", rosterWeek.week_start)
      .lte("date", rosterWeek.week_end)
      .eq("status", "draft");

    if (!draftShifts || draftShifts.length === 0) {
      return NextResponse.json({ error: "No draft shifts to publish." }, { status: 400 });
    }

    // 3. Get all non-draft shifts in the week (for overlap/rest checks)
    const { data: existingNonDraft } = await adminClient
      .from("shifts")
      .select("id, employee_id, date, scheduled_start, scheduled_finish, status, location, location_id")
      .eq("business_id", ctx.businessId)
      .gte("date", rosterWeek.week_start)
      .lte("date", rosterWeek.week_end)
      .not("status", "in", '("cancelled","declined","draft")');

    const existingShifts: ExistingShiftData[] = existingNonDraft || [];

    // 4. Get approved leave for the week
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: weekLeave } = await (adminClient as any)
      .from("employee_leave")
      .select("id, employee_id, leave_type, start_date, end_date, status")
      .eq("business_id", ctx.businessId)
      .eq("status", "APPROVED")
      .lte("start_date", rosterWeek.week_end)
      .gte("end_date", rosterWeek.week_start);

    const approvedLeave = weekLeave || [];

    // 5. Get availability for all employees in the draft
    const employeeIds: string[] = [...new Set<string>(
      draftShifts
        .filter((s: { employee_id: string | null }) => s.employee_id)
        .map((s: { employee_id: string }) => s.employee_id)
    )];

    const { data: allAvailability } = await adminClient
      .from("employee_availability")
      .select("*")
      .in("employee_id", employeeIds.length > 0 ? employeeIds : ["__none__"]);

    const availByEmployee = new Map<string, Map<number, typeof allAvailability extends (infer T)[] | null ? T : never>>();
    for (const a of allAvailability || []) {
      if (!availByEmployee.has(a.employee_id)) {
        availByEmployee.set(a.employee_id, new Map());
      }
      availByEmployee.get(a.employee_id)!.set(a.day_of_week, a);
    }

    // 6. Validate each draft shift
    const validationResults: ShiftValidationResult[] = [];
    let hasErrors = false;
    let hasWarnings = false;

    // Include draft shifts as "existing" for cross-draft overlap checking
    const allShiftsForValidation = [...existingShifts];

    for (const shift of draftShifts) {
      // Skip unfilled shifts — they don't need employee validation
      if (!shift.employee_id) continue;

      const emp = shift.employees;
      if (!emp) continue;

      const shiftDate = new Date(shift.date);
      const dayOfWeek = shiftDate.getDay();

      const input: ShiftAssignmentInput = {
        employeeId: shift.employee_id,
        businessId: ctx.businessId,
        date: shift.date,
        startTime: new Date(shift.scheduled_start).toISOString().slice(11, 16),
        endTime: new Date(shift.scheduled_finish).toISOString().slice(11, 16),
        location: shift.location || undefined,
      };

      const employeeData: EmployeeData = {
        id: emp.id,
        business_id: emp.business_id,
        full_name: emp.full_name,
        employment_status: emp.employment_status,
      };

      const availability = availByEmployee.get(shift.employee_id)?.get(dayOfWeek) || null;

      // Filter existing shifts for this employee
      const empExistingShifts = allShiftsForValidation.filter(
        (s) => s.employee_id === shift.employee_id && s.id !== shift.id
      );

      // Filter leave for this employee
      const empLeave = approvedLeave.filter(
        (l: { employee_id: string }) => l.employee_id === shift.employee_id
      );

      const result = validateShiftAssignment(
        input,
        employeeData,
        availability,
        empExistingShifts,
        empLeave,
      );

      if (result.errors.length > 0 || result.warnings.length > 0) {
        validationResults.push({
          shiftId: shift.id,
          employeeName: emp.full_name,
          date: shift.date,
          errors: result.errors,
          warnings: result.warnings,
        });

        if (result.errors.length > 0) hasErrors = true;
        if (result.warnings.length > 0) hasWarnings = true;
      }

      // Add this shift to the running list so later drafts check against it
      allShiftsForValidation.push({
        id: shift.id,
        employee_id: shift.employee_id,
        date: shift.date,
        scheduled_start: shift.scheduled_start,
        scheduled_finish: shift.scheduled_finish,
        status: shift.status,
        location_id: shift.location_id,
      });
    }

    // 7. Block on hard errors
    if (hasErrors) {
      return NextResponse.json(
        {
          error: "Cannot publish — there are validation errors.",
          validationResults,
        },
        { status: 400 }
      );
    }

    // 8. Return warnings for confirmation unless overridden
    if (hasWarnings && !overrideWarnings) {
      return NextResponse.json(
        {
          warning: true,
          message: "There are warnings. Send overrideWarnings: true to publish anyway.",
          validationResults,
        },
        { status: 409 }
      );
    }

    // 9. Publish: update all draft shifts to pending atomically
    const draftIds = draftShifts.map((s: { id: string }) => s.id);

    const { error: updateError } = await adminClient
      .from("shifts")
      .update({ status: "pending" })
      .in("id", draftIds)
      .eq("business_id", ctx.businessId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // 10. Update roster week status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: rosterError } = await (adminClient as any)
      .from("roster_weeks")
      .update({
        status: "PUBLISHED",
        total_shifts: draftShifts.length,
        published_at: new Date().toISOString(),
        published_by: ctx.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("business_id", ctx.businessId);

    if (rosterError) {
      return NextResponse.json({ error: rosterError.message }, { status: 500 });
    }

    // 11. Audit
    shiftAudit(
      "ROSTER_PUBLISHED",
      { businessId: ctx.businessId, userId: ctx.userId, role: ctx.role },
      id,
      {
        after: {
          roster_week_id: id,
          week_start: rosterWeek.week_start,
          week_end: rosterWeek.week_end,
          shifts_published: draftIds.length,
          warnings_overridden: hasWarnings,
        },
      }
    );

    return NextResponse.json({
      success: true,
      published: draftIds.length,
      warnings: validationResults.filter((r) => r.warnings.length > 0),
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
