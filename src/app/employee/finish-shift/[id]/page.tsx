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

interface TimesheetResult {
  worked_minutes: number;
  distance_km: number;
  wage_amount: number;
  mileage_amount: number;
  estimated_total: number;
}

export default function FinishShiftPage() {
  const params = useParams();
  const router = useRouter();
  const shiftId = params.id as string;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const proofFileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [shift, setShift] = useState<ShiftInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [timesheet, setTimesheet] = useState<TimesheetResult | null>(null);
  const [odometerRequired, setOdometerRequired] = useState(true);

  // Task proof warning state
  const [proofWarning, setProofWarning] = useState<{ message: string; missingProof: string[] } | null>(null);

  // Inline task proof upload state
  interface ProofReq { id: string; proof_type: string; instruction: string | null; minimum_photos: number; maximum_photos: number; is_required: boolean; }
  interface ProofSub { id: string; requirement_id: string; proof_type: string; photo_url: string | null; status: string; }
  const [proofRequirements, setProofRequirements] = useState<ProofReq[]>([]);
  const [proofSubmissions, setProofSubmissions] = useState<ProofSub[]>([]);
  const [proofUploading, setProofUploading] = useState<string | null>(null);
  const [proofUploadError, setProofUploadError] = useState("");

  const PROOF_LABELS: Record<string, { label: string; emoji: string }> = {
    BEFORE: { label: "Before Work", emoji: "📷" },
    DURING: { label: "During Work", emoji: "🔄" },
    AFTER: { label: "After Work", emoji: "✅" },
    OTHER: { label: "Other", emoji: "📎" },
  };

  async function loadProofData() {
    try {
      const [reqRes, subRes] = await Promise.all([
        fetch(`/api/task-proof/requirements?shiftId=${shiftId}`),
        fetch(`/api/task-proof/submissions?shiftId=${shiftId}`),
      ]);
      const reqs = await reqRes.json();
      const subs = await subRes.json();
      if (Array.isArray(reqs)) setProofRequirements(reqs);
      if (Array.isArray(subs)) setProofSubmissions(subs);
    } catch { /* ignore */ }
  }

  async function handleProofUpload(requirementId: string, proofType: string, file: File) {
    setProofUploading(requirementId);
    setProofUploadError("");
    try {
      const formData = new FormData();
      formData.append("photo", file);
      formData.append("shiftId", shiftId);
      formData.append("requirementId", requirementId);
      formData.append("proofType", proofType);
      const res = await fetch("/api/task-proof/submit", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) { setProofUploadError(data.error || "Upload failed."); }
      else { await loadProofData(); }
    } catch { setProofUploadError("Upload failed. Please try again."); }
    setProofUploading(null);
  }

  function getSubsForReq(reqId: string): ProofSub[] {
    return proofSubmissions.filter((s) => s.requirement_id === reqId && s.status !== "REPLACED");
  }

  // Form state
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [odometerReading, setOdometerReading] = useState("");

  useEffect(() => {
    Promise.all([
      fetch(`/api/shifts/${shiftId}`).then((r) => r.json()),
      fetch("/api/profile").then((r) => r.json()),
    ]).then(([shiftData, profileData]) => {
      if (shiftData.error) setError(shiftData.error);
      else setShift(shiftData);
      // Per-shift override takes priority over employee default
      if (shiftData.require_odometer !== null && shiftData.require_odometer !== undefined) {
        setOdometerRequired(shiftData.require_odometer);
      } else if (profileData?.odometer_tracking_enabled === false) {
        setOdometerRequired(false);
      }
      setLoading(false);
    }).catch(() => {
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

  async function handleSubmit(e: React.FormEvent, forceFinish = false) {
    e.preventDefault();

    if (odometerRequired) {
      if (!photo) {
        setError("Please take or upload an odometer photo.");
        return;
      }
      if (!odometerReading || parseFloat(odometerReading) < 0) {
        setError("Please enter a valid odometer reading.");
        return;
      }
    }

    setSubmitting(true);
    setError("");
    setProofWarning(null);

    const formData = new FormData();
    if (odometerRequired && photo) {
      formData.append("photo", photo);
      formData.append("odometer_reading", odometerReading);
    }
    formData.append("skip_odometer", odometerRequired ? "false" : "true");
    if (forceFinish) formData.append("forceFinish", "true");

    try {
      const res = await fetch(`/api/shifts/${shiftId}/finish`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      // Handle proof warning (409 = missing proof but can continue)
      if (res.status === 409 && data.requiresForce) {
        setProofWarning({
          message: data.message,
          missingProof: data.missingProof || [],
        });
        // Load proof requirements so the employee can upload inline
        loadProofData();
        setSubmitting(false);
        return;
      }

      if (!res.ok) {
        // Handle blocked by proof requirement
        if (data.proofBlocked) {
          setError(data.error);
        } else {
          setError(data.error || "Failed to finish shift.");
        }
        setSubmitting(false);
        return;
      }

      // Show success with timesheet summary
      setSuccess(true);
      if (data.timesheet) {
        setTimesheet(data.timesheet);
      }
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  function formatDuration(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;
  if (!shift) return <div className="text-center py-12 text-red-500">{error || "Shift not found."}</div>;

  // Can submit: if odometer required, need photo + reading; otherwise always ready
  const canSubmit = odometerRequired ? !!(photo && odometerReading) : true;

  // Success screen — show timesheet summary
  if (success) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <div className="text-5xl mb-3">✅</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Shift Completed!</h1>
          <p className="text-sm text-gray-500 mb-6">
            Your timesheet has been automatically generated and submitted for approval.
          </p>

          {timesheet && (
            <div className="bg-gray-50 rounded-lg p-4 text-left space-y-2 mb-6">
              <h2 className="font-semibold text-gray-900 text-sm mb-3">Timesheet Summary</h2>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Hours Worked</span>
                <span className="font-medium">{formatDuration(timesheet.worked_minutes)}</span>
              </div>
              {odometerRequired && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Distance</span>
                  <span className="font-medium">{timesheet.distance_km} km</span>
                </div>
              )}
              <hr className="my-2" />
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Wages</span>
                <span className="font-medium">${timesheet.wage_amount.toFixed(2)}</span>
              </div>
              {odometerRequired && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Mileage</span>
                  <span className="font-medium">${timesheet.mileage_amount.toFixed(2)}</span>
                </div>
              )}
              <hr className="my-2" />
              <div className="flex justify-between text-sm font-bold">
                <span>Estimated Total</span>
                <span className="text-green-600">${timesheet.estimated_total.toFixed(2)}</span>
              </div>
            </div>
          )}

          <button
            onClick={() => router.push("/employee/shifts")}
            className="w-full bg-blue-600 text-white rounded-lg py-3 text-sm font-medium
                       hover:bg-blue-700 transition-colors"
          >
            Back to My Shifts
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <button
        onClick={() => router.push(`/employee/shifts/${shiftId}`)}
        className="text-sm text-blue-600 hover:underline mb-4 inline-block"
      >
        ← Back to Shift
      </button>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Finish Shift</h1>
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
          {odometerRequired ? (
            <>
              {/* Step 1: Odometer Photo */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  📸 Step 1: Odometer Photo
                </label>
                <p className="text-xs text-gray-500 mb-2">
                  Take a photo of your vehicle&apos;s odometer after finishing.
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
                  placeholder="e.g. 45280"
                  value={odometerReading}
                  onChange={(e) => setOdometerReading(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 text-lg font-mono
                             focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </>
          ) : (
            <div className="bg-gray-50 rounded-lg p-4 text-center">
              <div className="text-2xl mb-2">🏁</div>
              <p className="text-sm text-gray-700 font-medium">Ready to finish shift</p>
              <p className="text-xs text-gray-500 mt-1">Odometer tracking is not required for your role.</p>
            </div>
          )}

          {/* Task Proof Warning + Inline Upload */}
          {proofWarning && (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-amber-600 text-lg">⚠️</span>
                <span className="font-bold text-amber-800 text-sm">Task Proof Missing</span>
              </div>
              <p className="text-sm text-amber-700 mb-3">{proofWarning.message}</p>

              {/* Inline proof upload cards */}
              {proofRequirements.length > 0 && (
                <div className="space-y-2 mb-3">
                  {proofUploadError && (
                    <div className="bg-red-50 text-red-700 text-xs rounded-lg p-2 border border-red-200">{proofUploadError}</div>
                  )}
                  {proofRequirements.map((req) => {
                    const pt = PROOF_LABELS[req.proof_type] || { label: req.proof_type, emoji: "📎" };
                    const subs = getSubsForReq(req.id);
                    const isComplete = subs.length >= req.minimum_photos;
                    const canUpload = subs.length < req.maximum_photos;
                    const isUploading = proofUploading === req.id;

                    return (
                      <div key={req.id} className={`rounded-lg border p-3 ${isComplete ? "border-green-300 bg-green-50" : "border-amber-200 bg-white"}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-900">
                            {pt.emoji} {pt.label}
                          </span>
                          {isComplete ? (
                            <span className="text-xs font-medium text-green-600">✓ {subs.length}/{req.minimum_photos}</span>
                          ) : (
                            <span className="text-xs font-medium text-amber-600">{subs.length}/{req.minimum_photos} needed</span>
                          )}
                        </div>
                        {canUpload && (
                          <>
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="hidden"
                              ref={(el) => { proofFileRefs.current[req.id] = el; }}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleProofUpload(req.id, req.proof_type, file);
                                e.target.value = "";
                              }}
                            />
                            <button
                              type="button"
                              disabled={isUploading}
                              onClick={() => proofFileRefs.current[req.id]?.click()}
                              className="mt-2 w-full bg-blue-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
                            >
                              {isUploading ? "Uploading…" : `📷 Take ${pt.label} Photo`}
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Missing proof list (when requirements haven't loaded yet) */}
              {proofRequirements.length === 0 && proofWarning.missingProof.length > 0 && (
                <ul className="text-xs text-amber-600 mb-3 space-y-0.5">
                  {proofWarning.missingProof.map((m, i) => (
                    <li key={i}>• {m}</li>
                  ))}
                </ul>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={(e) => handleSubmit(e as unknown as React.FormEvent, true)}
                  disabled={submitting}
                  className="flex-1 bg-amber-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50"
                >
                  {submitting ? "Finishing…" : "Finish Anyway"}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    setProofWarning(null);
                    handleSubmit(e as unknown as React.FormEvent, false);
                  }}
                  disabled={submitting}
                  className="flex-1 bg-green-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50"
                >
                  {submitting ? "Checking…" : "✓ Retry Finish"}
                </button>
              </div>
            </div>
          )}

          {/* Submit */}
          {!proofWarning && (
            <button
              type="submit"
              disabled={submitting || !canSubmit}
              className="w-full bg-red-600 text-white rounded-lg py-3.5 text-base font-bold
                         hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Finishing Shift…" : "🏁 CONFIRM & FINISH SHIFT"}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
