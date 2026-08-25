// PATCH /api/static-qr/[id] — pause, resume, or regenerate a static QR credential
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireAdmin();
    const { id } = await params;

    const body = await request.json();
    const { action } = body; // "pause" | "resume"

    if (!action || !["pause", "resume"].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "pause" or "resume".' },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // Verify credential belongs to this business
    const { data: credential } = await adminClient
      .from("static_qr_credentials")
      .select("id, status, location_id")
      .eq("id", id)
      .eq("business_id", ctx.businessId)
      .single();

    if (!credential) {
      return NextResponse.json({ error: "Credential not found." }, { status: 404 });
    }

    if (credential.status === "REVOKED") {
      return NextResponse.json(
        { error: "Cannot modify a revoked credential." },
        { status: 400 }
      );
    }

    if (action === "pause") {
      if (credential.status === "PAUSED") {
        return NextResponse.json(
          { error: "Credential is already paused." },
          { status: 400 }
        );
      }

      const { data: updated, error } = await adminClient
        .from("static_qr_credentials")
        .update({
          status: "PAUSED",
          paused_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(updated);
    }

    if (action === "resume") {
      if (credential.status === "ACTIVE") {
        return NextResponse.json(
          { error: "Credential is already active." },
          { status: 400 }
        );
      }

      const { data: updated, error } = await adminClient
        .from("static_qr_credentials")
        .update({
          status: "ACTIVE",
          paused_at: null,
        })
        .eq("id", id)
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json(updated);
    }
  } catch (err) {
    return handleTenantError(err);
  }
}
