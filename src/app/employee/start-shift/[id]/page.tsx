"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";

interface ShiftInfo {
  id: string;
  date: string;
  scheduled_start: string;
  scheduled_finish: string;
  location: string | null;
  status: string;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function StartShiftPage() {
  const params = useParams();
  const router = useRouter();
  const shiftId = params.id as string;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [shift, setShift] = useState<ShiftInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Form state
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [odometerReading, setOdometerReading] = useState("");

  useEffect(() => {
    fetch(`/api/shifts/${shiftId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setShift(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load shift.");
        setLoading(false);
      });
  }, [shiftId]);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setPhoto(file);
      const reader = new FileReader();
      reader.onloadend = () => setPhotoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!photo) {
      setError("Please take or upload an odometer photo.");
      return;
    }
    if (!odometerReading || parseFloat(odometerReading) < 0) {
      setError("Please enter a valid odometer reading.");
      return;
    }

    setSubmitting(true);
    setError("");

    const formData = new FormData();
    formData.append("photo", photo);
    formData.append("odometer_reading", odometerReading);

    try {
      const res = await fetch(`/api/shifts/${shiftId}/start`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to start shift.");
        setSubmitting(false);
        return;
      }

      // Success — redirect to shift detail
      router.push(`/employee/shifts/${shiftId}?started=true`);
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;
  if (!shift) return <div className="text-center py-12 text-red-500">{error || "Shift not found."}</div>;

  return (
    <div className="max-w-lg mx-auto">
      <button
        onClick={() => router.push(`/employee/shifts/${shiftId}`)}
        className="text-sm text-blue-600 hover:underline mb-4 inline-block"
      >
        ← Back to Shift
      </button>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Start Shift</h1>
        <p className="text-sm text-gray-500 mb-4">
          {formatDate(shift.date)} · {formatTime(shift.scheduled_start)} – {formatTime(shift.scheduled_finish)}
          {shift.location && ` · ${shift.location}`}
        </p>

        {error && (
          <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Step 1: Odometer Photo */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              📸 Step 1: Odometer Photo
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Take a photo of your vehicle&apos;s odometer before starting.
            </p>

            {photoPreview ? (
              <div className="relative">
                <img
                  src={photoPreview}
                  alt="Odometer preview"
                  className="w-full h-48 object-cover rounded-lg border border-gray-200"
                />
                <button
                  type="button"
                  onClick={() => {
                    setPhoto(null);
                    setPhotoPreview(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  className="absolute top-2 right-2 bg-white/80 text-gray-700 rounded-full w-8 h-8 flex items-center justify-center text-lg hover:bg-white"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <label className="flex-1 cursor-pointer bg-blue-50 border-2 border-dashed border-blue-300 rounded-lg p-6 text-center hover:bg-blue-100 transition-colors">
                  <div className="text-3xl mb-1">📷</div>
                  <div className="text-sm font-medium text-blue-700">Take Photo or Upload</div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handlePhotoChange}
                    className="hidden"
                  />
                </label>
              </div>
            )}
          </div>

          {/* Step 2: Odometer Reading */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              🔢 Step 2: Enter Odometer Reading (km)
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              placeholder="e.g. 45230"
              value={odometerReading}
              onChange={(e) => setOdometerReading(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-lg font-mono
                         focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || !photo || !odometerReading}
            className="w-full bg-green-600 text-white rounded-lg py-3.5 text-base font-bold
                       hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Starting Shift…" : "✅ CONFIRM & START SHIFT"}
          </button>
        </form>
      </div>
    </div>
  );
}
