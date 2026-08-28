// POST /api/shifts/[id]/finish — Employee finishes a shift
// Optionally uploads finish odometer photo, completes work session, auto-generates timesheet
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, handleTenantError } from "@/lib/services/tenantContext";
import { canFinishWork, type ShiftState } from "@/lib/services/shiftStateMachine";
import { finishWorkSession, getWorkSession } from "@/lib/services/workSessionService";
import { workSessionAudit } from "@/lib/services/auditService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: shiftId } = await params;
    const ctx = await requireRole("EMPLOYEE");

    if (!ctx.employeeId) {
      return NextResponse.json({ error: "Employee record not found." }, { status: 404 });
    }

    const adminClient = createAdminClient();

    // Get the shift
    const { data: shift } = await adminClient
      .from("shifts")
      .select("*")
      .eq("id", shiftId)
      .single();

    if (!shift) {
      return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    }
    if (shift.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (shift.employee_id !== ctx.employeeId) {
      return NextResponse.json({ error: "This shift is not assigned to you." }, { status: 403 });
    }

    // ── State machine guard ──
    const workSession = await getWorkSession(adminClient, shiftId);

    const shiftState: ShiftState = {
      shiftStatus: shift.status,
      workSessionStatus: workSession?.status || null,
      hasCheckedIn: false, // not relevant for finish check
    };

    const guard = canFinishWork(shiftState);
    if (!guard.allowed) {
      return NextResponse.json({ error: guard.reason }, { status: 400 });
    }

    // Check odometer requirement: per-shift override > employee default
    const { data: employee } = await adminClient
      .from("employees")
      .select("hourly_rate, mileage_rate, odometer_tracking_enabled")
      .eq("id", ctx.employeeId)
      .single();

    if (!employee) {
      return NextResponse.json({ error: "Employee record not found." }, { status: 404 });
    }

    const odometerEnabled = shift.require_odometer !== null
      ? shift.require_odometer                          // per-shift override
      : employee.odometer_tracking_enabled !== false;    // employee default

    // Check task proof requirements (applies regardless of odometer setting)
    const { data: proofRequirements } = await adminClient
      .from("task_proof_requirements")
      .select("*")
      .eq("shift_id", shiftId)
      .eq("business_id", ctx.businessId);

    let taskProofMissing = false;
    const taskProofMissingDetails: string[] = [];

    if (proofRequirements && proofRequirements.length > 0) {
      // Get submissions for this shift
      const { data: proofSubmissions } = await adminClient
        .from("task_proof_submissions")
        .select("requirement_id, status")
        .eq("shift_id", shiftId)
        .eq("employee_id", ctx.employeeId)
        .in("status", ["SUBMITTED", "APPROVED"]);

      for (const req of proofRequirements) {
        if (!req.is_required) continue;
        const subs = (proofSubmissions || []).filter((s) => s.requirement_id === req.id);
        if (subs.length < req.minimum_photos) {
          taskProofMissing = true;
          taskProofMissingDetails.push(`${req.proof_type} photo (${subs.length}/${req.minimum_photos})`);

          // If this requirement blocks finishing, reject
          if (!req.allow_finish_without_proof) {
            return NextResponse.json({
              error: `Required ${req.proof_type.toLowerCase()} proof must be submitted before finishing this shift.`,
              proofBlocked: true,
              missingProof: taskProofMissingDetails,
            }, { status: 400 });
          }
        }
      }
    }

    // Parse the form data
    const formData = await request.formData();
    const forceFinish = formData.get("forceFinish") === "true";

    // If proof is missing but allowed to finish, require explicit acknowledgment
    if (taskProofMissing && !forceFinish) {
      return NextResponse.json({
        warning: true,
        message: "Task proof is incomplete. You can still finish, but it will be flagged for admin review.",
        missingProof: taskProofMissingDetails,
        requiresForce: true,
      }, { status: 409 });
    }

    // Server timestamp for actual_finish
    const serverNow = new Date().toISOString();

    let startOdometerReading = 0;
    let finishOdometerReading = 0;

    if (odometerEnabled) {
      // Get the start odometer submission
      const { data: startOdometer } = await adminClient
        .from("odometer_submissions")
        .select("*")
        .eq("shift_id", shiftId)
        .eq("employee_id", ctx.employeeId)
        .eq("submission_type", "START")
        .single();

      if (!startOdometer) {
        return NextResponse.json({ error: "Start odometer record not found." }, { status: 400 });
      }

      startOdometerReading = startOdometer.odometer_reading;

      const photo = formData.get("photo") as File | null;
      const odometerReadingStr = formData.get("odometer_reading") as string;
      finishOdometerReading = odometerReadingStr ? parseFloat(odometerReadingStr) : NaN;

      if (!photo) {
        return NextResponse.json({ error: "Odometer photo is required." }, { status: 400 });
      }
      if (isNaN(finishOdometerReading) || finishOdometerReading < 0) {
        return NextResponse.json({ error: "Valid odometer reading is required." }, { status: 400 });
      }
      if (finishOdometerReading < startOdometerReading) {
        return NextResponse.json({
          error: `Finish odometer (${finishOdometerReading}) cannot be less than start odometer (${startOdometerReading}).`,
        }, { status: 400 });
      }

      // Upload photo
      const fileExt = photo.name.split(".").pop() || "jpg";
      const fileName = `${ctx.employeeId}/${shiftId}/finish_${Date.now()}.${fileExt}`;
      const arrayBuffer = await photo.arrayBuffer();
      const fileBuffer = new Uint8Array(arrayBuffer);

      const { error: uploadError } = await adminClient.storage
        .from("odometer-photos")
        .upload(fileName, fileBuffer, {
          contentType: photo.type || "image/jpeg",
          upsert: false,
        });

      if (uploadError) {
        console.error("Photo upload error:", uploadError);
        return NextResponse.json({ error: "Failed to upload photo." }, { status: 500 });
      }

      // Create finish odometer submission
      const { error: odometerError } = await adminClient
        .from("odometer_submissions")
        .insert({
          shift_id: shiftId,
          employee_id: ctx.employeeId,
          business_id: ctx.businessId,
          submission_type: "FINISH",
          photo_path: fileName,
          odometer_reading: finishOdometerReading,
          server_timestamp: serverNow,
        });

      if (odometerError) {
        console.error("Odometer submission error:", odometerError);
        return NextResponse.json({ error: "Failed to save odometer reading." }, { status: 500 });
      }
    }

    // ── Finish work session + generate timesheet (via domain service) ──
    // Use rate snapshots from the shift (set at creation time), falling back to employee rates
    const hourlyRateSnapshot = shift.hourly_rate_snapshot ?? employee.hourly_rate;
    const mileageRateSnapshot = shift.mileage_rate_snapshot ?? (odometerEnabled ? employee.mileage_rate : 0);

    try {
      const result = await finishWorkSession(adminClient, {
        shiftId,
        employeeId: ctx.employeeId,
        businessId: ctx.businessId,
        serverTimestamp: serverNow,
        hourlyRateSnapshot,
        mileageRateSnapshot: odometerEnabled ? mileageRateSnapshot : 0,
        startOdometerReading,
        finishOdometerReading,
        scheduledStartAt: shift.scheduled_start,
        scheduledEndAt: shift.scheduled_finish,
      });

      // Fire-and-forget audit
      workSessionAudit(
        "WORK_SESSION_FINISHED",
        { businessId: ctx.businessId, userId: ctx.userId, role: "EMPLOYEE" },
        result.workSessionId,
        {
          after: {
            shift_id: shiftId,
            timesheet_id: result.timesheetId,
            actual_worked_minutes: result.actualWorkedMinutes,
            payable_worked_minutes: result.payableWorkedMinutes,
            total_amount: result.totalAmount,
          },
        }
      );

      return NextResponse.json({
        success: true,
        actual_finish: result.actualFinishAt,
        message: "Shift finished and timesheet submitted!",
        timesheet: {
          id: result.timesheetId,
          worked_minutes: result.actualWorkedMinutes,
          distance_km: result.distanceKm,
          wage_amount: result.wageAmount,
          mileage_amount: result.mileageAmount,
          total_amount: result.totalAmount,
        },
      });
    } catch (finishErr) {
      console.error("Finish work session error:", finishErr);
      return NextResponse.json({
        success: false,
        actual_finish: serverNow,
        message: "Failed to finish shift. Please try again or contact admin.",
        timesheet_error: true,
      }, { status: 500 });
    }
  } catch (err) {
    return handleTenantError(err);
  }
}
