// GET  /api/notifications       — list notifications for current user
// PUT  /api/notifications       — mark notifications as read
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireMember, handleTenantError } from "@/lib/services/tenantContext";

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireMember();
    const adminClient = createAdminClient();
    const isAdmin = ctx.role === "ADMIN" || ctx.role === "OWNER";

    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get("unreadOnly") === "true";
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const countOnly = url.searchParams.get("countOnly") === "true";

    // If just counting unread
    if (countOnly) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (adminClient as any)
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("business_id", ctx.businessId)
        .eq("is_read", false);

      if (isAdmin) {
        query = query.eq("target_role", "admin");
      } else {
        query = query.eq("target_user_id", ctx.userId);
      }

      const { count } = await query;
      const response = NextResponse.json({ unreadCount: count || 0 });
      response.headers.set("Cache-Control", "private, max-age=30, stale-while-revalidate=60");
      return response;
    }

    // Full list
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (adminClient as any)
      .from("notifications")
      .select("*")
      .eq("business_id", ctx.businessId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (isAdmin) {
      query = query.eq("target_role", "admin");
    } else {
      query = query.eq("target_user_id", ctx.userId);
    }

    if (unreadOnly) {
      query = query.eq("is_read", false);
    }

    const { data: notifications, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ notifications: notifications || [] });
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireMember();
    const adminClient = createAdminClient();
    const isAdmin = ctx.role === "ADMIN" || ctx.role === "OWNER";

    const body = await request.json();
    const { action, notificationIds } = body;

    if (action === "mark_read" && Array.isArray(notificationIds) && notificationIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (adminClient as any)
        .from("notifications")
        .update({ is_read: true })
        .eq("business_id", ctx.businessId)
        .in("id", notificationIds);

      if (isAdmin) {
        query = query.eq("target_role", "admin");
      } else {
        query = query.eq("target_user_id", ctx.userId);
      }

      await query;
      return NextResponse.json({ success: true });
    }

    if (action === "mark_all_read") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query = (adminClient as any)
        .from("notifications")
        .update({ is_read: true })
        .eq("business_id", ctx.businessId)
        .eq("is_read", false);

      if (isAdmin) {
        query = query.eq("target_role", "admin");
      } else {
        query = query.eq("target_user_id", ctx.userId);
      }

      await query;
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return handleTenantError(err);
  }
}
