// Dynamic QR — stateless signed-token generation and validation.
// No database rows per refresh. Tokens are HMAC-SHA256 signed
// and contain locationId, businessId, issued-at, expires-at, and a nonce.
//
// The HMAC secret is derived from SUPABASE_SERVICE_ROLE_KEY so no
// extra env var is needed. This module runs SERVER-SIDE ONLY.

import crypto from "crypto";

// Derive a stable HMAC key from the service role key
function getHmacKey(): Buffer {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY — dynamic QR can only run server-side.");
  }
  // SHA-256 hash the service key to get a fixed-length 32-byte key
  return crypto.createHash("sha256").update(serviceKey).digest();
}

export interface DynamicQrPayload {
  lid: string;  // locationId
  bid: string;  // businessId
  iat: number;  // issued at (unix seconds)
  exp: number;  // expires at (unix seconds)
  nce: string;  // nonce (prevents replay even within the same second)
}

/**
 * Generate a signed dynamic QR token.
 * @param locationId - The work location ID
 * @param businessId - The business ID
 * @param ttlSeconds - Token time-to-live in seconds (from attendance_settings.dynamic_qr_refresh_seconds)
 * @returns The full QR payload string: WFA:DYN:{base64url-payload}.{base64url-signature}
 */
export function generateDynamicQrToken(
  locationId: string,
  businessId: string,
  ttlSeconds: number
): { token: string; expiresAt: number; issuedAt: number } {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttlSeconds;

  const payload: DynamicQrPayload = {
    lid: locationId,
    bid: businessId,
    iat: now,
    exp: expiresAt,
    nce: crypto.randomBytes(8).toString("hex"), // 16-char nonce
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getHmacKey())
    .update(payloadB64)
    .digest("base64url");

  return {
    token: `WFA:DYN:${payloadB64}.${signature}`,
    expiresAt,
    issuedAt: now,
  };
}

/**
 * Validate a scanned dynamic QR token.
 * @param token - The full QR string from the scan
 * @returns The decoded payload if valid, or an error string
 */
export function validateDynamicQrToken(
  token: string
): { valid: true; payload: DynamicQrPayload } | { valid: false; error: string } {
  // Parse format: WFA:DYN:{payload}.{signature}
  if (!token.startsWith("WFA:DYN:")) {
    return { valid: false, error: "Invalid QR format." };
  }

  const inner = token.slice("WFA:DYN:".length);
  const dotIndex = inner.lastIndexOf(".");
  if (dotIndex === -1) {
    return { valid: false, error: "Invalid QR format." };
  }

  const payloadB64 = inner.slice(0, dotIndex);
  const signatureB64 = inner.slice(dotIndex + 1);

  // Verify HMAC signature
  const expectedSig = crypto
    .createHmac("sha256", getHmacKey())
    .update(payloadB64)
    .digest("base64url");

  if (!crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(signatureB64))) {
    return { valid: false, error: "Invalid QR signature." };
  }

  // Decode payload
  let payload: DynamicQrPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
  } catch {
    return { valid: false, error: "Corrupt QR payload." };
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (now > payload.exp) {
    return { valid: false, error: "QR code has expired." };
  }

  // Sanity: token shouldn't be from the far future (clock drift tolerance: 30s)
  if (payload.iat > now + 30) {
    return { valid: false, error: "QR code timestamp is invalid." };
  }

  return { valid: true, payload };
}
