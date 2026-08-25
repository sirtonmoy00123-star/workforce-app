// POST /api/dynamic-qr/validate — validate a scanned dynamic QR token
// Used by the employee check-in flow (Phase 4)
import { NextResponse } from "next/server";
import { requireMember, handleTenantError } from "@/lib/services/tenantContext";
import { validateDynamicQrToken } from "@/lib/services/dynamicQr";

export async function POST(request: Request) {
  try {
    // Any authenticated member can validate (employee scanning the QR)
    const ctx = await requireMember();

    const body = await request.json();
    const { token } = body;

    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { error: "token is required." },
        { status: 400 }
      );
    }

    const result = validateDynamicQrToken(token);

    if (!result.valid) {
      return NextResponse.json(
        { valid: false, error: result.error },
        { status: 400 }
      );
    }

    // Verify the token belongs to the same business
    if (result.payload.bid !== ctx.businessId) {
      return NextResponse.json(
        { valid: false, error: "QR code does not belong to your business." },
        { status: 403 }
      );
    }

    return NextResponse.json({
      valid: true,
      locationId: result.payload.lid,
      businessId: result.payload.bid,
      issuedAt: result.payload.iat,
      expiresAt: result.payload.exp,
    });
  } catch (err) {
    return handleTenantError(err);
  }
}
