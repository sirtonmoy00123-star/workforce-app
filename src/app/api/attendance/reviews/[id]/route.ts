// GET  /api/attendance/reviews/[id] — single attendance record detail
// PUT  /api/attendance/reviews/[id] — admin review action (approve/reject)

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";
import { notifyEmployee } from "@/lib/services/notificationService";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAdmin();
    const { id } = await params;
    const adminClient = createAdminClient();

    // Fetch attendance record with joins
    const { data: record, error } = await adminClient
      .from("attendance_records")
      .select(
        `
        *,
        employees ( id, full_name, employee_number ),
        work_locations ( id, name, latitude, longitude ),
        shifts ( id, date, location, scheduled_start, scheduled_finish, status )
        `
      )
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (error || !record) {
      return NextResponse.json({ error: "Attendance record not found." }, { status: 404 });
    }

    // Fetch exceptions
    const { data: exceptions } = await adminClient
      .from("attendance_exceptions")
      .select("*")
      .eq("attendance_record_id", id)
      .eq("business_id", ctx.businessId)
      .order("created_at");

    // Generate signed URLs for photos (valid 1 hour)
    let selfieUrl: string | null = null;
    let sitePhotoUrl: string | null = null;

    if (record.selfie_photo_path) {
      const { data: signed } = await adminClient.storage
        .from("attendance-photos")
        .createSignedUrl(record.selfie_photo_path, 3600);
      selfieUrl = signed?.signedUrl || null;
    }

    if (record.site_photo_path) {
      const { data: signed } = await adminClient.storage
        .from("attendance-photos")
        .createSignedUrl(record.site_photo_path, 3600);
      sitePhotoUrl = signed?.signedUrl || null;
    }

    return NextResponse.json({
      record,
      exceptions: exceptions || [],
      selfieUrl,
      sitePhotoUrl,
    });
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAdmin();
    const { id } = await params;
    const adminClient = createAdminClient();

    const body = await request.json();
    const {
      action,           // "approve" | "reject"
      approvedStart,    // ISO string or null (use scheduled time)
      approvedFinish,   // ISO string or null
      reviewNote,       // admin note
      exceptionActions, // Array<{ exceptionId: string; status: "APPROVED" | "REJECTED" | "NOTED"; note?: string }>
    } = body;

    if (!action || !["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "action must be 'approve' or 'reject'." },
        { status: 400 }
      );
    }

    // Verify record exists and belongs to this business
    const { data: record } = await adminClient
      .from("attendance_records")
      .select("id, business_id, verification_status")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!record) {
      return NextResponse.json({ error: "Attendance record not found." }, { status: 404 });
    }

    // Update the attendance record
    type CheckinStatus = "NOT_CHECKED_IN" | "PRESENT" | "LATE" | "NEEDS_REVIEW" | "APPROVED_MANUALLY" | "ABSENT";
    type VerificationStatus = "PENDING" | "VERIFIED" | "NEEDS_REVIEW" | "REJECTED";

    const updateData: {
      verification_status: VerificationStatus;
      requires_review: boolean;
      reviewed_by: string;
      reviewed_at: string;
      review_note: string | null;
      approved_start?: string;
      approved_finish?: string;
      checkin_status?: CheckinStatus;
    } = {
      verification_status: (action === "approve" ? "VERIFIED" : "REJECTED") as VerificationStatus,
      requires_review: false,
      reviewed_by: ctx.userId,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote || null,
    };

    if (action === "approve") {
      if (approvedStart) updateData.approved_start = approvedStart;
      if (approvedFinish) updateData.approved_finish = approvedFinish;

      // If approved, also mark checkin_status as APPROVED_MANUALLY when it was NEEDS_REVIEW
      updateData.checkin_status = "APPROVED_MANUALLY" as const;
    }

    const { data: updatedRecord, error: updateError } = await adminClient
      .from("attendance_records")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Update exceptions if provided
    if (Array.isArray(exceptionActions) && exceptionActions.length > 0) {
      for (const ea of exceptionActions) {
        if (!ea.exceptionId || !["APPROVED", "REJECTED", "NOTED"].includes(ea.status)) continue;

        await adminClient
          .from("attendance_exceptions")
          .update({
            status: ea.status,
            admin_note: ea.note || null,
            resolved_at: new Date().toISOString(),
            resolved_by: ctx.userId,
          })
          .eq("id", ea.exceptionId)
          .eq("business_id", ctx.businessId);
      }
    }

    // ── Notify employee of the review result ──
    // Fetch the employee to get their auth user ID and name
    const { data: empRecord } = await adminClient
      .from("attendance_records")
      .select("employee_id")
      .eq("id", id)
      .single();

    if (empRecord?.employee_id) {
      const { data: emp } = await adminClient
        .from("employees")
        .select("id, full_name, user_id")
        .eq("id", empRecord.employee_id)
        .single();

      if (emp?.user_id) {
        const resultLabel = action === "approve" ? "Approved" : "Rejected";
        await notifyEmployee({
          businessId: ctx.businessId,
          targetUserId: emp.user_id,
          employeeId: emp.id,
          shiftId: "",
          attendanceId: id,
          type: "ATTENDANCE_CORRECTION_RESULT",
          title: `Attendance ${resultLabel}`,
          message: reviewNote
            ? `Your attendance was ${resultLabel.toLowerCase()}. Note: ${reviewNote}`
            : `Your attendance record was ${resultLabel.toLowerCase()} by your employer.`,
        });
      }
    }

    return NextResponse.json({ success: true, record: updatedRecord });
  } catch (err) {
    return handleTenantError(err);
  }
}
