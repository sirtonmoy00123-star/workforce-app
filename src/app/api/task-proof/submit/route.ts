// POST /api/task-proof/submit — Employee uploads a proof photo
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, handleTenantError } from "@/lib/services/tenantContext";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("EMPLOYEE");

    if (!ctx.employeeId) {
      return NextResponse.json({ error: "Employee record not found." }, { status: 404 });
    }

    const adminClient = createAdminClient();
    const formData = await request.formData();

    const photo = formData.get("photo") as File | null;
    const shiftId = formData.get("shiftId") as string;
    const requirementId = formData.get("requirementId") as string;
    const proofType = formData.get("proofType") as string;
    const employeeNote = formData.get("employeeNote") as string | null;

    // Validate required fields
    if (!photo) {
      return NextResponse.json({ error: "Photo is required." }, { status: 400 });
    }
    if (!shiftId || !requirementId || !proofType) {
      return NextResponse.json({ error: "shiftId, requirementId, and proofType are required." }, { status: 400 });
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(photo.type)) {
      return NextResponse.json({ error: "Invalid file type. Use JPEG, PNG, or WebP." }, { status: 400 });
    }

    // Validate file size
    if (photo.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "Photo too large. Maximum 10MB." }, { status: 400 });
    }

    // Verify shift exists and belongs to this employee + business
    const { data: shift } = await adminClient
      .from("shifts")
      .select("id, business_id, employee_id, status")
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

    // Verify requirement exists and belongs to this shift + business
    const { data: requirement } = await adminClient
      .from("task_proof_requirements")
      .select("id, business_id, shift_id, proof_type, minimum_photos, maximum_photos")
      .eq("id", requirementId)
      .single();

    if (!requirement) {
      return NextResponse.json({ error: "Proof requirement not found." }, { status: 404 });
    }
    if (requirement.business_id !== ctx.businessId || requirement.shift_id !== shiftId) {
      return NextResponse.json({ error: "Requirement does not match this shift." }, { status: 403 });
    }

    // Check max photos not exceeded
    const { count: existingCount } = await adminClient
      .from("task_proof_submissions")
      .select("id", { count: "exact", head: true })
      .eq("requirement_id", requirementId)
      .eq("employee_id", ctx.employeeId)
      .in("status", ["SUBMITTED", "APPROVED"]);

    if ((existingCount || 0) >= requirement.maximum_photos) {
      return NextResponse.json({
        error: `Maximum ${requirement.maximum_photos} photos allowed for this proof type.`,
      }, { status: 400 });
    }

    // Upload photo to storage
    const fileExt = photo.name.split(".").pop() || "jpg";
    const fileName = `${ctx.businessId}/${ctx.employeeId}/${shiftId}/task-proof/${proofType.toLowerCase()}/${Date.now()}.${fileExt}`;
    const arrayBuffer = await photo.arrayBuffer();
    const fileBuffer = new Uint8Array(arrayBuffer);

    const { error: uploadError } = await adminClient.storage
      .from("task-proof-photos")
      .upload(fileName, fileBuffer, {
        contentType: photo.type || "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("Task proof upload error:", uploadError);
      return NextResponse.json({ error: "Failed to upload photo." }, { status: 500 });
    }

    // Create submission record
    const serverNow = new Date().toISOString();

    const { data: submission, error: insertError } = await adminClient
      .from("task_proof_submissions")
      .insert({
        business_id: ctx.businessId,
        shift_id: shiftId,
        employee_id: ctx.employeeId,
        requirement_id: requirementId,
        proof_type: proofType as "BEFORE" | "DURING" | "AFTER" | "OTHER",
        photo_path: fileName,
        employee_note: employeeNote || null,
        server_timestamp: serverNow,
        status: "SUBMITTED",
      })
      .select()
      .single();

    if (insertError) {
      console.error("Task proof submission error:", insertError);
      return NextResponse.json({ error: "Failed to save proof submission." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      submission: {
        id: submission.id,
        proof_type: submission.proof_type,
        photo_path: submission.photo_path,
        server_timestamp: submission.server_timestamp,
        status: submission.status,
      },
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
