"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";

interface Shift {
  id: string;
  date: string;
  scheduled_start: string;
  scheduled_finish: string;
  location: string | null;
  instructions: string | null;
  status: string;
  employee?: {
    full_name: string;
    employee_number: string;
  };
  attendance?: {
    attendance_status: string;
    actual_start: string | null;
    actual_finish: string | null;
  } | null;
}

interface AttendanceInfo {
  attendanceRequired: boolean;
  record: {
    id: string;
    checkin_status: string;
    checkout_status: string;
    actual_checkin: string | null;
    actual_checkout: string | null;
    qr_verified: boolean;
    checkin_distance_metres: number | null;
    checkout_distance_metres: number | null;
    requires_review: boolean;
  } | null;
  settings: {
    checkout_method: string;
  } | null;
  location: { name: string } | null;
}

interface ProofRequirement {
  id: string;
  proof_type: string;
  instruction: string | null;
  minimum_photos: number;
  maximum_photos: number;
  is_required: boolean;
  allow_employee_note: boolean;
  allow_finish_without_proof: boolean;
}

interface ProofSubmission {
  id: string;
  requirement_id: string;
  proof_type: string;
  photo_url: string | null;
  employee_note: string | null;
  server_timestamp: string;
  status: string;
}

const PROOF_TYPE_LABELS: Record<string, { label: string; emoji: string }> = {
  BEFORE: { label: "Before Work", emoji: "📷" },
  DURING: { label: "During Work", emoji: "🔄" },
  AFTER: { label: "After Work", emoji: "✅" },
  OTHER: { label: "Other", emoji: "📎" },
};

// ── Phase detection ──
type ShiftPhase = "PENDING" | "CHECKIN" | "START" | "WORKING" | "DONE" | "DECLINED";

function detectPhase(
  shift: Shift,
  attendanceInfo: AttendanceInfo | null,
): ShiftPhase {
  if (shift.status === "declined") return "DECLINED";
  if (shift.status === "completed") return "DONE";
  if (shift.status === "pending" || shift.status === "updated_pending") return "PENDING";

  const isWorking = shift.attendance?.attendance_status === "working";
  if (isWorking) return "WORKING";

  // Accepted — check if attendance check-in is needed
  if (shift.status === "accepted") {
    const needsCheckin =
      attendanceInfo?.attendanceRequired &&
      (!attendanceInfo.record || attendanceInfo.record.checkin_status === "NOT_CHECKED_IN");
    if (needsCheckin) return "CHECKIN";
    return "START";
  }

  return "START";
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

// ── Progress stepper ──
function ProgressStepper({ phase, attendanceRequired }: { phase: ShiftPhase; attendanceRequired: boolean }) {
  if (phase === "PENDING" || phase === "DECLINED") return null;

  const steps = attendanceRequired
    ? [
        { key: "CHECKIN", label: "Check In" },
        { key: "START", label: "Start" },
        { key: "WORKING", label: "Working" },
        { key: "DONE", label: "Done" },
      ]
    : [
        { key: "START", label: "Start" },
        { key: "WORKING", label: "Working" },
        { key: "DONE", label: "Done" },
      ];

  const phaseOrder = steps.map((s) => s.key);
  const currentIdx = phaseOrder.indexOf(phase);

  return (
    <div className="flex items-center justify-between mb-6 px-2">
      {steps.map((step, i) => {
        const isDone = i < currentIdx;
        const isCurrent = i === currentIdx;
        return (
          <div key={step.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                  isDone
                    ? "bg-green-500 text-white"
                    : isCurrent
                    ? "bg-blue-600 text-white ring-2 ring-blue-200"
                    : "bg-gray-200 text-gray-400"
                }`}
              >
                {isDone ? "✓" : i + 1}
              </div>
              <span
                className={`text-[10px] mt-1 ${
                  isDone ? "text-green-600 font-medium" : isCurrent ? "text-blue-700 font-semibold" : "text-gray-400"
                }`}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-1.5 mt-[-12px] ${isDone ? "bg-green-400" : "bg-gray-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ShiftDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [shift, setShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [justStarted, setJustStarted] = useState(false);

  // Task Proof state
  const [proofRequirements, setProofRequirements] = useState<ProofRequirement[]>([]);
  const [proofSubmissions, setProofSubmissions] = useState<ProofSubmission[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState("");
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Attendance state
  const [attendanceInfo, setAttendanceInfo] = useState<AttendanceInfo | null>(null);

  async function loadProofData(shiftId: string) {
    try {
      const [reqRes, subRes] = await Promise.all([
        fetch(`/api/task-proof/requirements?shiftId=${shiftId}`),
        fetch(`/api/task-proof/submissions?shiftId=${shiftId}`),
      ]);
      const reqs = await reqRes.json();
      const subs = await subRes.json();
      if (Array.isArray(reqs)) setProofRequirements(reqs);
      if (Array.isArray(subs)) setProofSubmissions(subs);
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("started") === "true") {
      setJustStarted(true);
    }

    Promise.all([
      fetch(`/api/shifts/${id}`).then((r) => r.json()),
      fetch(`/api/attendance/status?shiftId=${id}`)
        .then((r) => r.json())
        .catch(() => null),
    ]).then(([shiftData, attendanceData]) => {
      if (shiftData.error) setError(shiftData.error);
      else {
        setShift(shiftData);
        // Only load proof data if the shift is being worked (WORKING phase)
        const isWorking = shiftData.attendance?.attendance_status === "working";
        if (isWorking) {
          loadProofData(id);
        }
      }
      if (attendanceData && !attendanceData.error) {
        setAttendanceInfo(attendanceData);
      }
      setLoading(false);
    }).catch(() => {
      setError("Failed to load shift.");
      setLoading(false);
    });
  }, [id]);

  async function handleAction(action: "accept" | "decline" | "accept_updated") {
    setActing(true);
    setError("");
    try {
      const res = await fetch(`/api/shifts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Action failed.");
      } else {
        setShift((prev) => (prev ? { ...prev, status: data.status } : prev));
      }
    } catch {
      setError("Something went wrong.");
    }
    setActing(false);
  }

  async function handlePhotoUpload(requirementId: string, proofType: string, file: File) {
    setUploading(requirementId);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("photo", file);
      formData.append("shiftId", id);
      formData.append("requirementId", requirementId);
      formData.append("proofType", proofType);

      const res = await fetch("/api/task-proof/submit", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setUploadError(data.error || "Upload failed.");
      } else {
        await loadProofData(id);
      }
    } catch {
      setUploadError("Upload failed. Please try again.");
    }
    setUploading(null);
  }

  async function handleCorrectionUpload(submissionId: string, file: File) {
    setUploading(submissionId);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.append("photo", file);

      const res = await fetch(`/api/task-proof/${submissionId}/correct`, {
        method: "PUT",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setUploadError(data.error || "Replacement upload failed.");
      } else {
        await loadProofData(id);
      }
    } catch {
      setUploadError("Replacement upload failed. Please try again.");
    }
    setUploading(null);
  }

  function getSubmissionsForReq(reqId: string): ProofSubmission[] {
    return proofSubmissions.filter(
      (s) => s.requirement_id === reqId && s.status !== "REPLACED"
    );
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;
  if (!shift) return <div className="text-center py-12 text-red-500">{error || "Shift not found."}</div>;

  const phase = detectPhase(shift, attendanceInfo);
  const attendanceRequired = attendanceInfo?.attendanceRequired ?? false;

  return (
    <div className="max-w-lg mx-auto">
      <button
        onClick={() => router.push("/employee/shifts")}
        className="text-sm text-blue-600 hover:underline mb-4 inline-block"
      >
        ← Back to Shifts
      </button>

      {justStarted && (
        <div className="bg-green-50 text-green-700 text-sm rounded-lg p-3 border border-green-200 mb-4">
          ✅ Shift started! Your clock is now running.
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900">Shift Details</h1>
          <StatusBadge status={phase === "WORKING" ? "working" : shift.status} />
        </div>

        {/* Progress stepper */}
        <ProgressStepper phase={phase} attendanceRequired={attendanceRequired} />

        {/* Shift info — always visible */}
        <div className="space-y-3 text-sm">
          <div>
            <span className="text-gray-500">Date</span>
            <div className="font-medium">{formatDate(shift.date)}</div>
          </div>
          <div>
            <span className="text-gray-500">Time</span>
            <div className="font-medium">
              {formatTime(shift.scheduled_start)} – {formatTime(shift.scheduled_finish)}
            </div>
          </div>
          {shift.location && (
            <div>
              <span className="text-gray-500">Location</span>
              <div className="font-medium">{shift.location}</div>
            </div>
          )}
          {shift.instructions && (
            <div>
              <span className="text-gray-500">Instructions</span>
              <div className="font-medium">{shift.instructions}</div>
            </div>
          )}
          {phase === "WORKING" && shift.attendance?.actual_start && (
            <div>
              <span className="text-gray-500">Started at</span>
              <div className="font-medium text-green-700">
                {new Date(shift.attendance.actual_start).toLocaleTimeString("en-AU", {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}
              </div>
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════════ */}
        {/* PHASE: PENDING — Accept / Decline          */}
        {/* ═══════════════════════════════════════════ */}
        {shift.status === "pending" && (
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => handleAction("accept")}
              disabled={acting}
              className="flex-1 bg-green-600 text-white rounded-xl py-3.5 text-base font-semibold
                         hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {acting ? "…" : "Accept"}
            </button>
            <button
              onClick={() => handleAction("decline")}
              disabled={acting}
              className="flex-1 bg-red-600 text-white rounded-xl py-3.5 text-base font-semibold
                         hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {acting ? "…" : "Decline"}
            </button>
          </div>
        )}

        {shift.status === "updated_pending" && (
          <div className="mt-6">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-amber-600 text-lg">⚠️</span>
                <span className="font-bold text-amber-800">Shift Changed</span>
              </div>
              <p className="text-sm text-amber-700">
                Your admin has updated this shift. Please review the new details above and confirm.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => handleAction("accept_updated")}
                disabled={acting}
                className="flex-1 bg-green-600 text-white rounded-lg py-2.5 text-sm font-medium
                           hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {acting ? "…" : "Accept Updated Shift"}
              </button>
              <button
                onClick={() => handleAction("decline")}
                disabled={acting}
                className="flex-1 bg-red-600 text-white rounded-lg py-2.5 text-sm font-medium
                           hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {acting ? "…" : "Decline"}
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* PHASE: CHECKIN — Only check-in button      */}
        {/* ═══════════════════════════════════════════ */}
        {phase === "CHECKIN" && (
          <div className="mt-6">
            <div className="bg-purple-50 border border-purple-200 rounded-xl p-5 text-center">
              <div className="text-3xl mb-2">📍</div>
              <h2 className="text-lg font-bold text-purple-900 mb-1">Check In First</h2>
              <p className="text-sm text-purple-700 mb-4">
                You need to check in at{" "}
                <span className="font-semibold">{attendanceInfo?.location?.name || shift.location}</span>{" "}
                before starting this shift.
              </p>
              <button
                onClick={() => router.push(`/employee/checkin/${shift.id}`)}
                className="w-full bg-purple-600 text-white rounded-xl py-3.5 text-base font-bold
                           hover:bg-purple-700 transition-colors"
              >
                📍 CHECK IN
              </button>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* PHASE: START — Checked in badge + Start    */}
        {/* ═══════════════════════════════════════════ */}
        {phase === "START" && (
          <div className="mt-6">
            {/* Show check-in completion badge if attendance was required */}
            {attendanceRequired && attendanceInfo?.record && attendanceInfo.record.checkin_status !== "NOT_CHECKED_IN" && (
              <div className="flex items-center gap-2 mb-4 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
                <span className="text-green-600 text-sm">✓</span>
                <span className="text-sm text-green-700 font-medium">
                  Checked in
                  {attendanceInfo.record.actual_checkin && (
                    <span className="text-green-600 font-normal">
                      {" "}at {new Date(attendanceInfo.record.actual_checkin).toLocaleTimeString("en-AU", {
                        hour: "numeric", minute: "2-digit", hour12: true,
                      })}
                    </span>
                  )}
                </span>
              </div>
            )}

            <button
              onClick={() => router.push(`/employee/start-shift/${shift.id}`)}
              className="w-full bg-blue-600 text-white rounded-xl py-4 text-lg font-bold
                         hover:bg-blue-700 transition-colors"
            >
              ▶ START SHIFT
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* PHASE: WORKING — Active shift              */}
        {/* ═══════════════════════════════════════════ */}
        {phase === "WORKING" && (
          <div className="mt-6 space-y-4">
            {/* Completed steps summary */}
            <div className="space-y-1.5">
              {attendanceRequired && attendanceInfo?.record && attendanceInfo.record.checkin_status !== "NOT_CHECKED_IN" && (
                <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2">
                  <span>✓</span>
                  <span>
                    Checked in
                    {attendanceInfo.record.actual_checkin && (
                      <span className="text-green-600">
                        {" "}at {new Date(attendanceInfo.record.actual_checkin).toLocaleTimeString("en-AU", {
                          hour: "numeric", minute: "2-digit", hour12: true,
                        })}
                      </span>
                    )}
                    {attendanceInfo.record.checkin_distance_metres != null && (
                      <span className="text-green-600"> · {attendanceInfo.record.checkin_distance_metres}m</span>
                    )}
                  </span>
                </div>
              )}
            </div>

            {/* Task Proof Section — only shown during WORKING phase */}
            {proofRequirements.length > 0 && (
              <div className="border-t border-gray-200 pt-4">
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  📷 Task Proof {proofRequirements.some((r) => r.is_required) ? "Required" : ""}
                </h2>

                {uploadError && (
                  <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-3">
                    {uploadError}
                  </div>
                )}

                {/* Progress */}
                {(() => {
                  const requiredReqs = proofRequirements.filter((r) => r.is_required);
                  const completedRequired = requiredReqs.filter((r) => {
                    const subs = getSubmissionsForReq(r.id);
                    return subs.length >= r.minimum_photos;
                  });
                  const total = requiredReqs.length;
                  const done = completedRequired.length;
                  return total > 0 ? (
                    <div className="mb-4">
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-600">
                          {done} of {total} required proof{total !== 1 ? "s" : ""} completed
                        </span>
                        {done >= total ? (
                          <span className="text-green-600 font-medium">✓ Complete</span>
                        ) : (
                          <span className="text-amber-600 font-medium">○ Incomplete</span>
                        )}
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div
                          className={`h-1.5 rounded-full transition-all ${
                            done >= total ? "bg-green-500" : "bg-amber-500"
                          }`}
                          style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ) : null;
                })()}

                {/* Per-requirement cards */}
                <div className="space-y-3">
                  {proofRequirements.map((req) => {
                    const pt = PROOF_TYPE_LABELS[req.proof_type] || { label: req.proof_type, emoji: "📎" };
                    const subs = getSubmissionsForReq(req.id);
                    const isComplete = subs.length >= req.minimum_photos;
                    const canUpload = subs.length < req.maximum_photos;
                    const isUploading = uploading === req.id;

                    return (
                      <div
                        key={req.id}
                        className={`rounded-xl border p-4 ${
                          isComplete
                            ? "border-green-200 bg-green-50"
                            : req.is_required
                            ? "border-amber-200 bg-amber-50"
                            : "border-gray-200 bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-gray-900">
                            {pt.emoji} {pt.label}
                          </span>
                          {isComplete ? (
                            <span className="text-xs font-medium text-green-600">✓ Complete</span>
                          ) : req.is_required ? (
                            <span className="text-xs font-medium text-amber-600">○ Required</span>
                          ) : (
                            <span className="text-xs font-medium text-gray-400">Optional</span>
                          )}
                        </div>

                        {req.instruction && (
                          <p className="text-xs text-gray-500 mb-2">{req.instruction}</p>
                        )}

                        {/* Uploaded photos */}
                        {subs.length > 0 && (
                          <div className="space-y-2 mb-2">
                            {subs.map((sub) => (
                              <div key={sub.id}>
                                <div className="flex items-start gap-2">
                                  <div className="relative flex-shrink-0">
                                    {sub.photo_url ? (
                                      <img
                                        src={sub.photo_url}
                                        alt={`${pt.label} proof`}
                                        className="w-16 h-16 object-cover rounded-lg border border-gray-200"
                                      />
                                    ) : (
                                      <div className="w-16 h-16 bg-gray-200 rounded-lg flex items-center justify-center text-xs text-gray-400">
                                        📷
                                      </div>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs text-gray-400">
                                      {new Date(sub.server_timestamp).toLocaleTimeString("en-AU", {
                                        hour: "numeric",
                                        minute: "2-digit",
                                        hour12: true,
                                      })}
                                    </div>
                                    {sub.status === "CORRECTION_REQUIRED" && (
                                      <div className="mt-1">
                                        <div className="text-xs text-red-600 font-medium mb-1">⚠ Correction Required</div>
                                        <input
                                          type="file"
                                          accept="image/*"
                                          capture="environment"
                                          onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) handleCorrectionUpload(sub.id, file);
                                            e.target.value = "";
                                          }}
                                          className="hidden"
                                          id={`correction-${sub.id}`}
                                        />
                                        <label
                                          htmlFor={`correction-${sub.id}`}
                                          className={`inline-block px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                                            uploading === sub.id
                                              ? "bg-gray-200 text-gray-400"
                                              : "bg-red-600 text-white"
                                          }`}
                                        >
                                          {uploading === sub.id ? "Uploading…" : "📷 Upload Replacement"}
                                        </label>
                                      </div>
                                    )}
                                    {sub.status === "APPROVED" && (
                                      <div className="text-xs text-green-600 font-medium">✓ Approved</div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="text-xs text-gray-400 mb-2">
                          {subs.length} of {req.minimum_photos}–{req.maximum_photos} photos
                        </div>

                        {/* Upload button */}
                        {canUpload && (
                          <div>
                            <input
                              ref={(el) => {
                                fileInputRefs.current[req.id] = el;
                              }}
                              type="file"
                              accept="image/*"
                              capture="environment"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handlePhotoUpload(req.id, req.proof_type, file);
                                e.target.value = "";
                              }}
                              className="hidden"
                            />
                            <button
                              type="button"
                              onClick={() => fileInputRefs.current[req.id]?.click()}
                              disabled={isUploading}
                              className={`w-full rounded-lg py-2.5 text-sm font-medium transition-colors ${
                                isUploading
                                  ? "bg-gray-200 text-gray-400"
                                  : "bg-blue-600 text-white hover:bg-blue-700"
                              }`}
                            >
                              {isUploading ? "Uploading…" : subs.length > 0 ? "📷 Add Another Photo" : "📷 Take Photo"}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Attendance check-out — only during WORKING phase */}
            {attendanceRequired && attendanceInfo?.record && (() => {
              const record = attendanceInfo.record!;
              const checkedOut = record.checkout_status && record.checkout_status !== "NOT_CHECKED_OUT";

              if (checkedOut) {
                return (
                  <div className="flex items-center gap-2 text-sm text-indigo-700 bg-indigo-50 rounded-lg px-3 py-2">
                    <span>✓</span>
                    <span>
                      Checked out
                      {record.actual_checkout && (
                        <span className="text-indigo-600">
                          {" "}at {new Date(record.actual_checkout).toLocaleTimeString("en-AU", {
                            hour: "numeric", minute: "2-digit", hour12: true,
                          })}
                        </span>
                      )}
                    </span>
                  </div>
                );
              }

              return (
                <button
                  onClick={() => router.push(`/employee/checkout/${shift.id}`)}
                  className="w-full bg-indigo-600 text-white rounded-xl py-3 text-base font-bold
                             hover:bg-indigo-700 transition-colors"
                >
                  📍 CHECK OUT
                </button>
              );
            })()}

            {/* Finish Shift — always shown during WORKING */}
            <button
              onClick={() => router.push(`/employee/finish-shift/${shift.id}`)}
              className="w-full bg-red-600 text-white rounded-xl py-4 text-lg font-bold
                         hover:bg-red-700 transition-colors animate-pulse"
            >
              🏁 FINISH SHIFT
            </button>
          </div>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* PHASE: DONE — Completed summary            */}
        {/* ═══════════════════════════════════════════ */}
        {phase === "DONE" && (
          <div className="mt-6 text-center">
            <div className="text-3xl mb-2">✅</div>
            <p className="text-sm text-green-600 font-medium">This shift has been completed.</p>
          </div>
        )}

        {/* ═══════════════════════════════════════════ */}
        {/* PHASE: DECLINED                            */}
        {/* ═══════════════════════════════════════════ */}
        {phase === "DECLINED" && (
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">You declined this shift.</p>
          </div>
        )}
      </div>
    </div>
  );
}
