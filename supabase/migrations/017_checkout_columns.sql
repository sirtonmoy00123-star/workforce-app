-- Migration 017: Add checkout-specific columns to attendance_records
--
-- The checkout API captures selfie and QR verification, but these
-- had no dedicated columns — the data was lost after upload.

-- Checkout selfie photo path (separate from check-in selfie)
ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS checkout_selfie_path TEXT;

-- Whether QR was verified at checkout (check-in has qr_verified)
ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS checkout_qr_verified BOOLEAN NOT NULL DEFAULT false;
