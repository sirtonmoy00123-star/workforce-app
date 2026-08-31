// GET  /api/admin/notification-settings — get business notification settings
// PUT  /api/admin/notification-settings — update settings
import { NextResponse } from "next/server";
import { requireAdmin, handleTenantError } from "@/lib/services/tenantContext";
import {
  getBusinessNotificationSettings,
  updateBusinessNotificationSettings,
} from "@/lib/services/notificationService";

export async function GET() {
  try {
    const ctx = await requireAdmin();
    const settings = await getBusinessNotificationSettings(ctx.businessId);
    return NextResponse.json(settings);
  } catch (err) {
    return handleTenantError(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireAdmin();
    const body = await request.json();

    // Validate inputs
    const updates: Record<string, unknown> = {};

    if (body.shiftReminderMinutes !== undefined) {
      if (!Array.isArray(body.shiftReminderMinutes) || body.shiftReminderMinutes.some((m: number) => m < 1)) {
        return NextResponse.json({ error: "Invalid reminder minutes." }, { status: 400 });
      }
      updates.shiftReminderMinutes = body.shiftReminderMinutes;
    }

    if (body.missingCheckinEmployeeMinutes !== undefined) {
      const val = parseInt(body.missingCheckinEmployeeMinutes);
      if (isNaN(val) || val < 1 || val > 120) {
        return NextResponse.json({ error: "Check-in employee threshold must be 1-120 minutes." }, { status: 400 });
      }
      updates.missingCheckinEmployeeMinutes = val;
    }

    if (body.missingCheckinAdminMinutes !== undefined) {
      const val = parseInt(body.missingCheckinAdminMinutes);
      if (isNaN(val) || val < 1 || val > 120) {
        return NextResponse.json({ error: "Check-in admin threshold must be 1-120 minutes." }, { status: 400 });
      }
      updates.missingCheckinAdminMinutes = val;
    }

    if (body.missingCheckoutEmployeeMinutes !== undefined) {
      const val = parseInt(body.missingCheckoutEmployeeMinutes);
      if (isNaN(val) || val < 1 || val > 120) {
        return NextResponse.json({ error: "Checkout employee threshold must be 1-120 minutes." }, { status: 400 });
      }
      updates.missingCheckoutEmployeeMinutes = val;
    }

    if (body.missingCheckoutAdminMinutes !== undefined) {
      const val = parseInt(body.missingCheckoutAdminMinutes);
      if (isNaN(val) || val < 1 || val > 120) {
        return NextResponse.json({ error: "Checkout admin threshold must be 1-120 minutes." }, { status: 400 });
      }
      updates.missingCheckoutAdminMinutes = val;
    }

    if (body.autoMarkAbsent !== undefined) {
      updates.autoMarkAbsent = !!body.autoMarkAbsent;
    }

    if (body.defaultOfferExpiryHours !== undefined) {
      const val = parseInt(body.defaultOfferExpiryHours);
      if (isNaN(val) || val < 0 || val > 168) {
        return NextResponse.json({ error: "Offer expiry must be 0-168 hours." }, { status: 400 });
      }
      updates.defaultOfferExpiryHours = val;
    }

    await updateBusinessNotificationSettings(ctx.businessId, updates);
    const settings = await getBusinessNotificationSettings(ctx.businessId);
    return NextResponse.json({ success: true, settings });
  } catch (err) {
    return handleTenantError(err);
  }
}
