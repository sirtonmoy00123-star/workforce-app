// GET /api/task-proof/submissions?shiftId=xxx — get proof submissions for a shift
// Returns submissions with signed image URLs
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(request: Request) {
  try {
    const ctx = await requireMember();
    const url = new URL(request.url);
    const shiftId = url.searchParams.get("shiftId");

    if (!shiftId) {
      return NextResponse.json({ error: "shiftId is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Verify shift belongs to same business
    const { data: shift } = await adminClient
      .from("shifts")
      .select("id, business_id, employee_id")
      .eq("id", shiftId)
      .single();

    if (!shift || shift.business_id !== ctx.businessId) {
      return NextResponse.json({ error: "Shift not found." }, { status: 404 });
    }

    // Employee can only see their own submissions
    if (ctx.role === "EMPLOYEE" && shift.employee_id !== ctx.employeeId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: submissions, error } = await adminClient
      .from("task_proof_submissions")
      .select("*")
      .eq("shift_id", shiftId)
      .eq("business_id", ctx.businessId)
      .order("created_at");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Generate signed URLs for photos
    const withUrls = await Promise.all(
      (submissions || []).map(async (sub) => {
        const { data: signedData } = await adminClient.storage
          .from("task-proof-photos")
          .createSignedUrl(sub.photo_path, 3600); // 1 hour expiry

        return {
          ...sub,
          photo_url: signedData?.signedUrl || null,
        };
      })
    );

    return NextResponse.json(withUrls);
  } catch (err) {
    return handleTenantError(err);
  }
}
