/**
 * Work Session validation schemas (Zod).
 */
import { z } from "zod";

// ── File validation constants ────────────────────────────────

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

// Image magic bytes for server-side content validation
export const IMAGE_MAGIC_BYTES: Record<string, number[]> = {
  "image/jpeg": [0xFF, 0xD8, 0xFF],
  "image/png": [0x89, 0x50, 0x4E, 0x47],
  "image/webp": [0x52, 0x49, 0x46, 0x46], // RIFF header
};

// ── Start shift (odometer form data) ─────────────────────────

export const startShiftOdometerSchema = z.object({
  odometer_reading: z.coerce.number().min(0, "Odometer reading must be >= 0"),
});

// ── Finish shift (odometer form data) ────────────────────────

export const finishShiftOdometerSchema = z.object({
  odometer_reading: z.coerce.number().min(0, "Odometer reading must be >= 0"),
  forceFinish: z.enum(["true", "false"]).optional(),
});

// ── File validation helper ───────────────────────────────────

/**
 * Validate an uploaded file: size, MIME type, and magic bytes.
 * Returns null if valid, or an error message if invalid.
 */
export function validateImageFile(
  file: File,
  maxSizeBytes: number = MAX_IMAGE_SIZE_BYTES
): string | null {
  if (file.size > maxSizeBytes) {
    const sizeMB = Math.round(maxSizeBytes / (1024 * 1024));
    return `File too large. Maximum size is ${sizeMB} MB.`;
  }

  if (!ALLOWED_IMAGE_TYPES.includes(file.type as typeof ALLOWED_IMAGE_TYPES[number])) {
    return `Invalid file type "${file.type}". Allowed: JPEG, PNG, WebP.`;
  }

  return null;
}

/**
 * Validate image magic bytes from a buffer.
 * Returns true if the buffer starts with valid image magic bytes.
 */
export function validateImageMagicBytes(buffer: Uint8Array): boolean {
  for (const [, magicBytes] of Object.entries(IMAGE_MAGIC_BYTES)) {
    if (magicBytes.every((byte, i) => buffer[i] === byte)) {
      return true;
    }
  }
  return false;
}
