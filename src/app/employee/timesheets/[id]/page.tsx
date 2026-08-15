"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";

interface TimesheetDetail {
  id: string;
  shift_id: string;
  employee_id: string;
  scheduled_start: string;
  scheduled_finish: string;
  actual_start: string;
  actual_finish: string;
  worked_minutes: number;
  start_odometer: number;
  finish_odometer: number;
  distance_km: number;
  hourly_rate_snapshot: number;
  mileage_rate_snapshot: number;
  wage_amount: number;
  mileage_amount: number;
  estimated_total: number;
  approved_total: number | null;
  status: string;
}

interface CorrectionRecord {
  id: string;
  correction_round: number;
  requested_fields: string[];
  admin_note: string;
  original_values: Record<string, unknown>;
  corrected_values: Record<string, unknown> | null;
  recalculated_values: Record<string, unknown> | null;
  employee_note: string | null;
  requested_at: string;
  submitted_at: string | null;
  status: string;
}

const FIELD_LABELS: Record<string, string> = {
  actual_start: "Start time",
  actual_finish: "Finish time",
  start_odometer: "Starting odometer",
  finish_odometer: "Ending odometer",
  start_photo: "Starting odometer photo",
  finish_photo: "Ending odometer photo",
  other: "Other",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function isoToTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export default function EmployeeTimesheetCorrectionPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [timesheet, setTimesheet] = useState<TimesheetDetail | null>(null);
  const [correction, setCorrection] = useState<CorrectionRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [acting, setActing] = useState(false);

  // Edit form
  const [editStartTime, setEditStartTime] = useState("");
  const [editFinishTime, setEditFinishTime] = useState("");
  const [editStartOdometer, setEditStartOdometer] = useState("");
  const [editFinishOdometer, setEditFinishOdometer] = useState("");
  const [employeeNote, setEmployeeNote] = useState("");

  // Review mode
  const [showReview, setShowReview] = useState(false);
  const [preview, setPreview] = useState<{
    worked_minutes: number;
    distance_km: number;
    wage_amount: number;
    mileage_amount: number;
    estimated_total: number;
  } | null>(null);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadData() {
    setLoading(true);
    try {
      const tsRes = await fetch(`/api/timesheets/${id}`);
      const tsData = await tsRes.json();

      if (tsData.error) { setError(tsData.error); setLoading(false); return; }
      setTimesheet(tsData);

      // Pre-fill edit values from timesheet
      setEditStartTime(isoToTimeInput(tsData.actual_start));
      setEditFinishTime(isoToTimeInput(tsData.actual_finish));
      setEditStartOdometer(String(tsData.start_odometer));
      setEditFinishOdometer(String(tsData.finish_odometer));

      // Corrections endpoint may 500 if migration not run yet — handle gracefully
      try {
        const corrRes = await fetch(`/api/timesheets/${id}/corrections`);
        if (corrRes.ok) {
          const corrData = await corrRes.json();
          if (Array.isArray(corrData)) {
            const pending = corrData
              .filter((c: CorrectionRecord) => c.status === "pending")
              .sort((a: CorrectionRecord, b: CorrectionRecord) => b.correction_round - a.correction_round)[0] || null;
            setCorrection(pending);
          }
        }
      } catch {
        // Table may not exist yet — ignore
      }
    } catch {
      setError("Failed to load timesheet.");
    }
    setLoading(false);
  }

  function isFieldUnlocked(field: string): boolean {
    if (!correction) return false;
    return correction.requested_fields.includes(field);
  }

  function handleReviewCorrection() {
    setError("");

    // Build the corrected ISO timestamps using the original date
    const originalDate = new Date(timesheet!.actual_start).toISOString().split("T")[0];
    const correctedStart = new Date(`${originalDate}T${editStartTime}:00`);
    const correctedFinish = new Date(`${originalDate}T${editFinishTime}:00`);

    if (correctedFinish <= correctedStart) {
      setError("Finish time must be after start time.");
      return;
    }

    const startOdo = Number(editStartOdometer);
    const finishOdo = Number(editFinishOdometer);
    if (isNaN(startOdo) || isNaN(finishOdo)) {
      setError("Odometer values must be numbers.");
      return;
    }
    if (finishOdo < startOdo) {
      setError("Ending odometer cannot be lower than starting odometer.");
      return;
    }

    if (!employeeNote.trim()) {
      setError("Please provide an explanation note.");
      return;
    }

    // Calculate preview
    const diffMs = correctedFinish.getTime() - correctedStart.getTime();
    const workedMinutes = Math.round(diffMs / 60000);
    const distanceKm = finishOdo - startOdo;
    const hours = workedMinutes / 60;
    const wageAmount = Math.round(hours * timesheet!.hourly_rate_snapshot * 100) / 100;
    const mileageAmount = Math.round(distanceKm * timesheet!.mileage_rate_snapshot * 100) / 100;
    const estimatedTotal = Math.round((wageAmount + mileageAmount) * 100) / 100;

    setPreview({ worked_minutes: workedMinutes, distance_km: distanceKm, wage_amount: wageAmount, mileage_amount: mileageAmount, estimated_total: estimatedTotal });
    setShowReview(true);
  }

  async function submitCorrection() {
    setError("");
    setActing(true);

    const originalDate = new Date(timesheet!.actual_start).toISOString().split("T")[0];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const corrected_values: Record<string, any> = {};
    if (isFieldUnlocked("actual_start")) {
      corrected_values.actual_start = new Date(`${originalDate}T${editStartTime}:00`).toISOString();
    }
    if (isFieldUnlocked("actual_finish")) {
      corrected_values.actual_finish = new Date(`${originalDate}T${editFinishTime}:00`).toISOString();
    }
    if (isFieldUnlocked("start_odometer")) {
      corrected_values.start_odometer = Number(editStartOdometer);
    }
    if (isFieldUnlocked("finish_odometer")) {
      corrected_values.finish_odometer = Number(editFinishOdometer);
    }

    try {
      const res = await fetch(`/api/timesheets/${id}/corrections/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          corrected_values,
          employee_note: employeeNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to submit correction.");
        setShowReview(false);
      } else {
        setSuccess("Correction submitted successfully! Your manager will review it.");
        setShowReview(false);
        setCorrection(null);
        // Reload data
        loadData();
      }
    } catch {
      setError("Something went wrong.");
      setShowReview(false);
    }
    setActing(false);
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;
  if (!timesheet) return <div className="text-center py-12 text-red-500">{error || "Timesheet not found."}</div>;

  const isCorrectionMode = timesheet.status === "correction_required" && correction;

  return (
    <div className="max-w-lg mx-auto">
      <button
        onClick={() => router.push("/employee/timesheets")}
        className="text-sm text-blue-600 hover:underline mb-4 inline-block"
      >
        ← Back to Timesheets
      </button>

      {success && (
        <div className="bg-green-50 text-green-700 text-sm rounded-lg p-3 border border-green-200 mb-4">
          ✅ {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">
          {error}
        </div>
      )}

      {/* ── Correction Required Banner ── */}
      {isCorrectionMode && !showReview && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-orange-500 text-xl">⚠️</span>
            <h2 className="font-bold text-orange-800">Timesheet Correction Needed</h2>
          </div>
          <p className="text-sm text-orange-700 mb-2">
            {formatDateTime(timesheet.actual_start)}
          </p>
          <p className="text-sm text-orange-700 mb-3">
            Your manager has asked you to review:
          </p>
          <ul className="text-sm text-orange-800 space-y-1 mb-3">
            {correction.requested_fields.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span>•</span>
                <span className="font-medium">{FIELD_LABELS[f] || f}</span>
              </li>
            ))}
          </ul>
          <div className="bg-white rounded-lg p-3 border border-orange-200">
            <p className="text-xs font-semibold text-gray-500 mb-1">Manager note:</p>
            <p className="text-sm text-gray-700 italic">&ldquo;{correction.admin_note}&rdquo;</p>
          </div>
        </div>
      )}

      {/* ── Review Correction (Before Submit) ── */}
      {showReview && preview && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-bold text-gray-900">Review Correction</h2>
          <p className="text-sm text-gray-500">{formatDateTime(timesheet.actual_start)}</p>

          <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
            {isFieldUnlocked("actual_start") && (
              <>
                <div className="flex justify-between text-gray-500">
                  <span>Previous Start</span>
                  <span>{formatTime(timesheet.actual_start)}</span>
                </div>
                <div className="flex justify-between text-blue-600 font-medium">
                  <span>Corrected Start</span>
                  <span>{formatHHMM(editStartTime)}</span>
                </div>
              </>
            )}
            {isFieldUnlocked("actual_finish") && (
              <>
                <div className="flex justify-between text-gray-500">
                  <span>Previous Finish</span>
                  <span>{formatTime(timesheet.actual_finish)}</span>
                </div>
                <div className="flex justify-between text-blue-600 font-medium">
                  <span>Corrected Finish</span>
                  <span>{formatHHMM(editFinishTime)}</span>
                </div>
              </>
            )}
            {isFieldUnlocked("start_odometer") && (
              <>
                <div className="flex justify-between text-gray-500">
                  <span>Previous Start Odometer</span>
                  <span>{timesheet.start_odometer.toLocaleString()} km</span>
                </div>
                <div className="flex justify-between text-blue-600 font-medium">
                  <span>Corrected</span>
                  <span>{Number(editStartOdometer).toLocaleString()} km</span>
                </div>
              </>
            )}
            {isFieldUnlocked("finish_odometer") && (
              <>
                <div className="flex justify-between text-gray-500">
                  <span>Previous Finish Odometer</span>
                  <span>{timesheet.finish_odometer.toLocaleString()} km</span>
                </div>
                <div className="flex justify-between text-blue-600 font-medium">
                  <span>Corrected</span>
                  <span>{Number(editFinishOdometer).toLocaleString()} km</span>
                </div>
              </>
            )}
          </div>

          {/* Recalculated summary */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm space-y-2">
            <h3 className="font-semibold text-blue-800">Recalculated</h3>
            <div className="flex justify-between text-gray-500">
              <span>Previous Hours</span>
              <span>{formatDuration(timesheet.worked_minutes)}</span>
            </div>
            <div className="flex justify-between text-blue-700 font-medium">
              <span>New Hours</span>
              <span>{formatDuration(preview.worked_minutes)}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>Previous Distance</span>
              <span>{timesheet.distance_km} km</span>
            </div>
            <div className="flex justify-between text-blue-700 font-medium">
              <span>New Distance</span>
              <span>{preview.distance_km} km</span>
            </div>
            <hr className="border-blue-200" />
            <div className="flex justify-between text-gray-500">
              <span>Previous Estimated Pay</span>
              <span>${timesheet.estimated_total.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-blue-800 font-bold">
              <span>New Estimated Pay</span>
              <span>${preview.estimated_total.toFixed(2)}</span>
            </div>
          </div>

          {/* Employee note */}
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <span className="font-medium text-gray-600">Your note: </span>
            <span className="text-gray-700 italic">&ldquo;{employeeNote}&rdquo;</span>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setShowReview(false)}
              className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm
                         font-medium hover:bg-gray-50 transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={submitCorrection}
              disabled={acting}
              className="flex-1 bg-green-600 text-white rounded-lg py-2.5 text-sm font-bold
                         hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {acting ? "Submitting…" : "Submit Correction"}
            </button>
          </div>
        </div>
      )}

      {/* ── Edit Form (Correction Mode) ── */}
      {isCorrectionMode && !showReview && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">Correct Timesheet</h2>
            <StatusBadge status={timesheet.status} />
          </div>

          {/* Scheduled */}
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <span className="text-gray-500">Scheduled: </span>
            <span className="font-medium">
              {formatTime(timesheet.scheduled_start)} – {formatTime(timesheet.scheduled_finish)}
            </span>
          </div>

          {/* Start Time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Actual Start
              {!isFieldUnlocked("actual_start") && (
                <span className="ml-2 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">🔒 LOCKED</span>
              )}
            </label>
            {isFieldUnlocked("actual_start") ? (
              <input
                type="time"
                value={editStartTime}
                onChange={(e) => setEditStartTime(e.target.value)}
                className="w-full rounded-lg border-2 border-orange-300 bg-orange-50 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            ) : (
              <div className="px-3 py-2 text-sm bg-gray-50 rounded-lg text-gray-600">
                {formatTime(timesheet.actual_start)}
              </div>
            )}
          </div>

          {/* Finish Time */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Actual Finish
              {!isFieldUnlocked("actual_finish") && (
                <span className="ml-2 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">🔒 LOCKED</span>
              )}
            </label>
            {isFieldUnlocked("actual_finish") ? (
              <input
                type="time"
                value={editFinishTime}
                onChange={(e) => setEditFinishTime(e.target.value)}
                className="w-full rounded-lg border-2 border-orange-300 bg-orange-50 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            ) : (
              <div className="px-3 py-2 text-sm bg-gray-50 rounded-lg text-gray-600">
                {formatTime(timesheet.actual_finish)}
              </div>
            )}
          </div>

          {/* Start Odometer */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Starting Odometer
              {!isFieldUnlocked("start_odometer") && (
                <span className="ml-2 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">🔒 LOCKED</span>
              )}
            </label>
            {isFieldUnlocked("start_odometer") ? (
              <div className="relative">
                <input
                  type="number"
                  value={editStartOdometer}
                  onChange={(e) => setEditStartOdometer(e.target.value)}
                  className="w-full rounded-lg border-2 border-orange-300 bg-orange-50 px-3 py-2 pr-10 text-sm
                             focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <span className="absolute right-3 top-2 text-sm text-gray-400">km</span>
              </div>
            ) : (
              <div className="px-3 py-2 text-sm bg-gray-50 rounded-lg text-gray-600">
                {timesheet.start_odometer.toLocaleString()} km
              </div>
            )}
          </div>

          {/* Finish Odometer */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Ending Odometer
              {!isFieldUnlocked("finish_odometer") && (
                <span className="ml-2 text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">🔒 LOCKED</span>
              )}
            </label>
            {isFieldUnlocked("finish_odometer") ? (
              <div className="relative">
                <input
                  type="number"
                  value={editFinishOdometer}
                  onChange={(e) => setEditFinishOdometer(e.target.value)}
                  className="w-full rounded-lg border-2 border-orange-300 bg-orange-50 px-3 py-2 pr-10 text-sm
                             focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <span className="absolute right-3 top-2 text-sm text-gray-400">km</span>
              </div>
            ) : (
              <div className="px-3 py-2 text-sm bg-gray-50 rounded-lg text-gray-600">
                {timesheet.finish_odometer.toLocaleString()} km
              </div>
            )}
          </div>

          {/* Employee Note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Your Explanation <span className="text-red-500">*</span>
            </label>
            <textarea
              value={employeeNote}
              onChange={(e) => setEmployeeNote(e.target.value)}
              rows={2}
              placeholder="I entered the ending odometer number incorrectly."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            onClick={handleReviewCorrection}
            className="w-full bg-blue-600 text-white rounded-lg py-3 text-sm font-bold
                       hover:bg-blue-700 transition-colors"
          >
            Review Correction
          </button>
        </div>
      )}

      {/* ── Normal Timesheet View (non-correction statuses) ── */}
      {!isCorrectionMode && !showReview && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">Timesheet</h2>
            <StatusBadge status={timesheet.status} />
          </div>

          <div className="text-sm space-y-2">
            <div className="flex justify-between">
              <span className="text-gray-500">Date</span>
              <span className="font-medium">{formatDateTime(timesheet.actual_start)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Time</span>
              <span className="font-medium">
                {formatTime(timesheet.actual_start)} – {formatTime(timesheet.actual_finish)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Hours</span>
              <span className="font-medium">{formatDuration(timesheet.worked_minutes)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Distance</span>
              <span className="font-medium">{timesheet.distance_km} km</span>
            </div>
            <hr />
            <div className="flex justify-between font-bold">
              <span>{timesheet.status === "approved" ? "Approved Total" : "Estimated Total"}</span>
              <span className="text-green-600">
                ${(timesheet.approved_total ?? timesheet.estimated_total).toFixed(2)}
              </span>
            </div>
          </div>

          {timesheet.status === "correction_submitted" && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
              📝 Your correction has been submitted. Waiting for manager review.
            </div>
          )}
          {timesheet.status === "approved" && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
              ✅ This timesheet has been approved.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
