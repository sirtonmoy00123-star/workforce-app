// GET /api/task-proof/templates — list task proof templates for business
// POST /api/task-proof/templates — create a new template
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";

export async function GET() {
  try {
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();

    const { data: templates, error } = await adminClient
      .from("task_proof_templates")
      .select(`
        *,
        task_proof_template_items (*)
      `)
      .eq("business_id", ctx.businessId)
      .order("name");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(templates || []);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireAdmin();
    const body = await request.json();
    const { name, description, items } = body;

    if (!name || !name.trim()) {
      return NextResponse.json({ error: "Template name is required." }, { status: 400 });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: "At least one proof item is required." }, { status: 400 });
    }

    const adminClient = createAdminClient();

    // Create template
    const { data: template, error: templateError } = await adminClient
      .from("task_proof_templates")
      .insert({
        business_id: ctx.businessId,
        name: name.trim(),
        description: description || null,
        created_by: ctx.userId,
      })
      .select()
      .single();

    if (templateError) {
      return NextResponse.json({ error: templateError.message }, { status: 500 });
    }

    // Create template items
    const templateItems = items.map((item: {
      proof_type: string;
      instruction?: string;
      minimum_photos?: number;
      maximum_photos?: number;
      is_required?: boolean;
      allow_employee_note?: boolean;
      allow_finish_without_proof?: boolean;
    }, idx: number) => ({
      template_id: template.id,
      proof_type: item.proof_type as "BEFORE" | "DURING" | "AFTER" | "OTHER",
      instruction: item.instruction || null,
      minimum_photos: item.minimum_photos || 1,
      maximum_photos: item.maximum_photos || 6,
      is_required: item.is_required !== false,
      allow_employee_note: item.allow_employee_note !== false,
      allow_finish_without_proof: item.allow_finish_without_proof !== false,
      sort_order: idx,
    }));

    const { error: itemsError } = await adminClient
      .from("task_proof_template_items")
      .insert(templateItems);

    if (itemsError) {
      // Rollback: delete the template
      await adminClient.from("task_proof_templates").delete().eq("id", template.id);
      return NextResponse.json({ error: "Failed to create template items." }, { status: 500 });
    }

    return NextResponse.json({ success: true, template });
  } catch (err) {
    return handleTenantError(err);
  }
}
