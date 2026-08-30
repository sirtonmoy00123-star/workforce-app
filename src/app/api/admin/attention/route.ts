// GET /api/admin/attention — unified attention queue for admin
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";
import {
  getAttentionItems,
  getAttentionSummary,
  getAttentionWithSummary,
  AttentionPriority,
  AttentionCategory,
} from "@/lib/services/attentionQueue";

export async function GET(request: Request) {
  try {
    const ctx = await requireAdmin();
    const adminClient = createAdminClient();
    const url = new URL(request.url);

    const summaryOnly = url.searchParams.get("summary") === "true";
    const withSummary = url.searchParams.get("withSummary") === "true";
    const priority = url.searchParams.get("priority") as AttentionPriority | null;
    const category = url.searchParams.get("category") as AttentionCategory | null;
    const limit = parseInt(url.searchParams.get("limit") || "50");

    // Summary only — lightweight COUNT queries
    if (summaryOnly) {
      const summary = await getAttentionSummary(adminClient, ctx.businessId);
      const response = NextResponse.json(summary);
      response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
      return response;
    }

    // Combined: summary + items in one call (saves a duplicate round-trip)
    if (withSummary) {
      const result = await getAttentionWithSummary(adminClient, ctx.businessId, { limit });
      const response = NextResponse.json(result);
      response.headers.set("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
      return response;
    }

    const items = await getAttentionItems(adminClient, ctx.businessId, {
      limit,
      priority: priority || undefined,
      category: category || undefined,
    });

    const response = NextResponse.json({
      items,
      count: items.length,
    });

    // Cache briefly
    response.headers.set("Cache-Control", "private, max-age=15, stale-while-revalidate=30");

    return response;
  } catch (err) {
    return handleTenantError(err);
  }
}
