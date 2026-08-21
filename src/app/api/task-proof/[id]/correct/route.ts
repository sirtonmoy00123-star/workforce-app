// POST /api/task-proof/[id]/correct — Admin requests correction on a proof submission
// PUT /api/task-proof/[id]/correct — Employee submits replacement photo
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, requireRole, handleTenantError } from "@/lib/services/tenantContext";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: submissionId } = await params;
    const ctx = await requireAdmin();
    const body = await request.json();
    const { reason } = body;

    if (!reason || !reason.trim()) {
      return NextResponse.json({ error: "Correction reason is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Get the submission
    const { data: submission } = await adminClient
      .from("task_proof_submissions")
      .select("*")
      .eq("id", submissionId)
      .single();

    if (!submission) {
      return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    }
    if (submission.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Update submission status to CORRECTION_REQUIRED
    const { error: updateError } = await adminClient
      .from("task_proof_submissions")
      .update({
        status: "CORRECTION_REQUIRED",
        correction_reason: reason.trim(),
        correction_requested_by: ctx.userId,
        correction_requested_at: new Date().toISOString(),
      })
      .eq("id", submissionId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "Correction requested." });
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: submissionId } = await params;
    const ctx = await requireRole("EMPLOYEE");

    if (!ctx.employeeId) {
      return NextResponse.json({ error: "Employee record not found." }, { status: 404 });
    }

    const adminClient = createAdminClient();

    // Get the original submission
    const { data: original } = await adminClient
      .from("task_proof_submissions")
      .select("*")
      .eq("id", submissionId)
      .single();

    if (!original) {
      return NextResponse.json({ error: "Submission not found." }, { status: 404 });
    }
    if (original.business_id !== ctx.businessId || original.employee_id !== ctx.employeeId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (original.status !== "CORRECTION_REQUIRED") {
      return NextResponse.json({ error: "This submission does not need correction." }, { status: 400 });
    }

    // Parse the replacement photo
    const formData = await request.formData();
    const photo = formData.get("photo") as File | null;
    const employeeNote = formData.get("employeeNote") as string | null;

    if (!photo) {
      return NextResponse.json({ error: "Replacement photo is required." }, { status: 400 });
    }

    // Upload replacement photo
    const fileExt = photo.name.split(".").pop() || "jpg";
    const fileName = `${ctx.businessId}/${ctx.employeeId}/${original.shift_id}/task-proof/${original.proof_type.toLowerCase()}/replacement_${Date.now()}.${fileExt}`;
    const arrayBuffer = await photo.arrayBuffer();
    const fileBuffer = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await adminClient.storage
      .from("task-proof-photos")
      .upload(fileName, fileBuffer, {
        contentType: photo.type || "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: "Failed to upload replacement photo." }, { status: 500 });
    }

    // Mark original as REPLACED
    await adminClient
      .from("task_proof_submissions")
      .update({ status: "REPLACED" })
      .eq("id", submissionId);

    // Create new submission linked to original
    const serverNow = new Date().toISOString();
    const { data: newSub, error: insertError } = await adminClient
      .from("task_proof_submissions")
      .insert({
        business_id: ctx.businessId,
        shift_id: original.shift_id,
        employee_id: ctx.employeeId,
        requirement_id: original.requirement_id,
        proof_type: original.proof_type as "BEFORE" | "DURING" | "AFTER" | "OTHER",
        photo_path: fileName,
        employee_note: employeeNote || null,
        server_timestamp: serverNow,
        status: "SUBMITTED",
        replaces_submission_id: submissionId,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: "Failed to save replacement." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      submission: newSub,
      message: "Replacement photo submitted.",
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
