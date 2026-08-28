"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";

interface AttendanceExceptionInfo {
  id: string;
  exception_type: string;
  difference_minutes: number | null;
  difference_metres: number | null;
  status: string;
}

interface AttendanceInfo {
  id: string;
  checkin_status: string;
  checkout_status: string;
  actual_checkin: string | null;
  actual_checkout: string | null;
  qr_verified: boolean;
  checkin_distance_metres: number | null;
  checkout_distance_metres: number | null;
  selfie_photo_path: string | null;
  site_photo_path: string | null;
  verification_status: string;
  requires_review: boolean;
  approved_start: string | null;
  approved_finish: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  exceptions: AttendanceExceptionInfo[];
}

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
  total_amount: number;
  approved_total: number | null;
  status: string;
  created_at: string;
  employee?: { full_name: string; employee_number: string } | null;
  shift_location: string | null;
  shift_scheduled_start: string | null;
  shift_scheduled_finish: string | null;
  shift_work_start: string | null;
  shift_work_finish: string | null;
  attendance: AttendanceInfo | null;
  odometer_submissions: Array<{
    id: string;
    submission_type: string;
    photo_path: string;
    odometer_reading: number;
    server_timestamp: string;
  }>;
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

// Field labels for display
const FIELD_LABELS: Record<string, string> = {
  actual_start: "Start time",
  actual_finish: "Finish time",
  start_odometer: "Starting odometer",
  finish_odometer: "Ending odometer",
  start_photo: "Starting odometer photo",
  finish_photo: "Ending odometer photo",
  other: "Other",
};

const CORRECTABLE_FIELDS = [
  { key: "actual_start", label: "Start time" },
  { key: "actual_finish", label: "Finish time" },
  { key: "start_odometer", label: "Starting odometer" },
  { key: "finish_odometer", label: "Ending odometer" },
  { key: "start_photo", label: "Starting odometer photo" },
  { key: "finish_photo", label: "Ending odometer photo" },
  { key: "other", label: "Other" },
];

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

export default function AdminTimesheetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [timesheet, setTimesheet] = useState<TimesheetDetail | null>(null);
  const [corrections, setCorrections] = useState<CorrectionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Task proof state
  const [proofSubs, setProofSubs] = useState<{ id: string; proof_type: string; photo_url: string | null; server_timestamp: string; status: string; employee_note: string | null }[]>([]);
  const [proofReqs, setProofReqs] = useState<{ id: string; proof_type: string; is_required: boolean; minimum_photos: number }[]>([]);
  const [showProofGallery, setShowProofGallery] = useState(false);

  // Correction modal state
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [adminNote, setAdminNote] = useState("");
  const [correctionError, setCorrectionError] = useState("");

  // Correction history
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadData() {
    setLoading(true);
    try {
      const tsRes = await fetch(`/api/timesheets/${id}`);
      const tsData = await tsRes.json();

      if (tsData.error) setError(tsData.error);
      else {
        setTimesheet(tsData);
        // Fetch task proof data
        if (tsData.shift_id) {
          Promise.all([
            fetch(`/api/task-proof/requirements?shiftId=${tsData.shift_id}`).then((r) => r.json()),
            fetch(`/api/task-proof/submissions?shiftId=${tsData.shift_id}`).then((r) => r.json()),
          ]).then(([reqs, subs]) => {
            if (Array.isArray(reqs)) setProofReqs(reqs);
            if (Array.isArray(subs)) setProofSubs(subs.filter((s: { status: string }) => s.status !== "REPLACED"));
          }).catch(() => {});
        }
      }

      // Corrections endpoint may 500 if migration not run yet — handle gracefully
      try {
        const corrRes = await fetch(`/api/timesheets/${id}/corrections`);
        if (corrRes.ok) {
          const corrData = await corrRes.json();
          if (Array.isArray(corrData)) setCorrections(corrData);
        }
      } catch {
        // Table may not exist yet — ignore
      }
    } catch {
      setError("Failed to load timesheet.");
    }
    setLoading(false);
  }

  async function handleApprove() {
    setActing(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/timesheets/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Action failed.");
      } else {
        setTimesheet((prev) => prev ? { ...prev, status: data.status } : prev);
        setSuccess("Timesheet approved!");
        loadData();
      }
    } catch {
      setError("Something went wrong.");
    }
    setActing(false);
  }

  function openCorrectionModal() {
    setShowCorrectionModal(true);
    setSelectedFields([]);
    setAdminNote("");
    setCorrectionError("");
  }

  function toggleField(field: string) {
    setSelectedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]
    );
  }

  async function sendCorrectionRequest() {
    setCorrectionError("");

    if (selectedFields.length === 0) {
      setCorrectionError("Select at least one problem field.");
      return;
    }
    if (!adminNote.trim()) {
      setCorrectionError("A note to the employee is required.");
      return;
    }

    setActing(true);
    try {
      const res = await fetch(`/api/timesheets/${id}/corrections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requested_fields: selectedFields,
          admin_note: adminNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCorrectionError(data.error || "Failed to send correction request.");
      } else {
        setShowCorrectionModal(false);
        setSuccess(`Correction request sent (Round ${data.correction_round}).`);
        loadData();
      }
    } catch {
      setCorrectionError("Something went wrong.");
    }
    setActing(false);
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;
  if (!timesheet) return <div className="text-center py-12 text-red-500">{error || "Timesheet not found."}</div>;

  // Find the latest submitted correction for comparison
  const latestSubmitted = corrections
    .filter((c) => c.status === "submitted")
    .sort((a, b) => b.correction_round - a.correction_round)[0] || null;

  const showComparisonView = timesheet.status === "correction_submitted" && latestSubmitted;

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={() => router.push("/admin/timesheets")}
        className="text-sm text-blue-600 hover:underline mb-4 inline-block"
      >
        ← Back to Timesheets
      </button>

      {success && (
        <div className="bg-green-50 text-green-700 text-sm rounded-lg p-3 border border-green-200 mb-4">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {showComparisonView ? "Timesheet Correction Review" : "Timesheet Review"}
            </h1>
            <p className="text-sm text-gray-500">
              {timesheet.employee?.full_name} ({timesheet.employee?.employee_number})
            </p>
          </div>
          <StatusBadge status={timesheet.status} />
        </div>

        {/* ── Correction Comparison View ── */}
        {showComparisonView && latestSubmitted && (
          <>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-blue-600 text-lg">📝</span>
                <span className="font-bold text-blue-800">
                  Correction Submitted — Round {latestSubmitted.correction_round}
                </span>
              </div>
              <p className="text-blue-700">
                Review the employee&apos;s corrections below and approve or request changes again.
              </p>
            </div>

            {/* Before vs Corrected Table */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-200">
                      <th className="text-left py-2 pr-4 font-medium">Field</th>
                      <th className="text-right py-2 px-2 font-medium">Before</th>
                      <th className="text-right py-2 pl-2 font-medium">Corrected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    <ComparisonRow
                      label="Start time"
                      before={formatTime(latestSubmitted.original_values.actual_start as string)}
                      after={latestSubmitted.corrected_values?.actual_start
                        ? formatTime(latestSubmitted.corrected_values.actual_start as string)
                        : formatTime(latestSubmitted.original_values.actual_start as string)}
                      changed={latestSubmitted.original_values.actual_start !== latestSubmitted.corrected_values?.actual_start}
                    />
                    <ComparisonRow
                      label="Finish time"
                      before={formatTime(latestSubmitted.original_values.actual_finish as string)}
                      after={latestSubmitted.corrected_values?.actual_finish
                        ? formatTime(latestSubmitted.corrected_values.actual_finish as string)
                        : formatTime(latestSubmitted.original_values.actual_finish as string)}
                      changed={latestSubmitted.original_values.actual_finish !== latestSubmitted.corrected_values?.actual_finish}
                    />
                    <ComparisonRow
                      label="Start odometer"
                      before={`${Number(latestSubmitted.original_values.start_odometer).toLocaleString()} km`}
                      after={latestSubmitted.corrected_values?.start_odometer !== undefined
                        ? `${Number(latestSubmitted.corrected_values.start_odometer).toLocaleString()} km`
                        : `${Number(latestSubmitted.original_values.start_odometer).toLocaleString()} km`}
                      changed={latestSubmitted.original_values.start_odometer !== latestSubmitted.corrected_values?.start_odometer}
                    />
                    <ComparisonRow
                      label="Finish odometer"
                      before={`${Number(latestSubmitted.original_values.finish_odometer).toLocaleString()} km`}
                      after={latestSubmitted.corrected_values?.finish_odometer !== undefined
                        ? `${Number(latestSubmitted.corrected_values.finish_odometer).toLocaleString()} km`
                        : `${Number(latestSubmitted.original_values.finish_odometer).toLocaleString()} km`}
                      changed={latestSubmitted.original_values.finish_odometer !== latestSubmitted.corrected_values?.finish_odometer}
                    />
                    <ComparisonRow
                      label="Hours"
                      before={formatDuration(latestSubmitted.original_values.worked_minutes as number)}
                      after={latestSubmitted.recalculated_values
                        ? formatDuration(latestSubmitted.recalculated_values.worked_minutes as number)
                        : formatDuration(latestSubmitted.original_values.worked_minutes as number)}
                      changed={latestSubmitted.original_values.worked_minutes !== latestSubmitted.recalculated_values?.worked_minutes}
                    />
                    <ComparisonRow
                      label="Distance"
                      before={`${latestSubmitted.original_values.distance_km} km`}
                      after={latestSubmitted.recalculated_values
                        ? `${latestSubmitted.recalculated_values.distance_km} km`
                        : `${latestSubmitted.original_values.distance_km} km`}
                      changed={latestSubmitted.original_values.distance_km !== latestSubmitted.recalculated_values?.distance_km}
                    />
                    <ComparisonRow
                      label="Total pay"
                      before={`$${Number(latestSubmitted.original_values.total_amount ?? latestSubmitted.original_values.estimated_total).toFixed(2)}`}
                      after={latestSubmitted.recalculated_values
                        ? `$${Number(latestSubmitted.recalculated_values.total_amount ?? latestSubmitted.recalculated_values.estimated_total).toFixed(2)}`
                        : `$${Number(latestSubmitted.original_values.total_amount ?? latestSubmitted.original_values.estimated_total).toFixed(2)}`}
                      changed={(latestSubmitted.original_values.total_amount ?? latestSubmitted.original_values.estimated_total) !== (latestSubmitted.recalculated_values?.total_amount ?? latestSubmitted.recalculated_values?.estimated_total)}
                    />
                  </tbody>
                </table>
              </div>
            </div>

            {/* Employee note */}
            {latestSubmitted.employee_note && (
              <div className="bg-gray-50 rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-1">Employee Note</h3>
                <p className="text-sm text-gray-600 italic">
                  &ldquo;{latestSubmitted.employee_note}&rdquo;
                </p>
              </div>
            )}

            {/* Approve / Needs Correction Again */}
            <div className="flex gap-3">
              <button
                onClick={openCorrectionModal}
                disabled={acting}
                className="flex-1 bg-orange-500 text-white rounded-lg py-3 text-sm font-bold
                           hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                {acting ? "…" : "⚠️ Needs Correction Again"}
              </button>
              <button
                onClick={handleApprove}
                disabled={acting}
                className="flex-1 bg-green-600 text-white rounded-lg py-3 text-sm font-bold
                           hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {acting ? "…" : "✅ Approve Timesheet"}
              </button>
            </div>
          </>
        )}

        {/* ── Normal Timesheet View (not comparison) ── */}
        {!showComparisonView && (
          <>
            {/* Roster (Scheduled) */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
              <h2 className="font-semibold text-gray-900">📅 Roster</h2>
              <div className="flex justify-between">
                <span className="text-gray-500">Date</span>
                <span className="font-medium">{formatDateTime(timesheet.actual_start)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Scheduled</span>
                <span className="font-medium">
                  {formatTime(timesheet.scheduled_start)} – {formatTime(timesheet.scheduled_finish)}
                </span>
              </div>
              {timesheet.shift_location && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Location</span>
                  <span className="font-medium">{timesheet.shift_location}</span>
                </div>
              )}
            </div>

            {/* Attendance */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">📋 Attendance</h2>
                {timesheet.attendance ? (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    timesheet.attendance.verification_status === "VERIFIED"
                      ? "text-green-700 bg-green-100"
                      : timesheet.attendance.verification_status === "REJECTED"
                      ? "text-red-700 bg-red-100"
                      : timesheet.attendance.verification_status === "NEEDS_REVIEW"
                      ? "text-amber-700 bg-amber-100"
                      : "text-gray-600 bg-gray-100"
                  }`}>
                    {timesheet.attendance.verification_status === "VERIFIED" ? "✓ Verified" :
                     timesheet.attendance.verification_status === "REJECTED" ? "✗ Rejected" :
                     timesheet.attendance.verification_status === "NEEDS_REVIEW" ? "⏳ Needs Review" :
                     "○ Pending"}
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">No record</span>
                )}
              </div>

              {timesheet.attendance ? (
                <>
                  {/* Check-In */}
                  <div className="flex justify-between">
                    <span className="text-gray-500">Check-In</span>
                    <span className="font-medium">
                      {timesheet.attendance.actual_checkin
                        ? formatTime(timesheet.attendance.actual_checkin)
                        : "—"}
                      {timesheet.attendance.checkin_status === "LATE" && (
                        <span className="ml-1 text-amber-600 text-xs">(Late)</span>
                      )}
                    </span>
                  </div>

                  {/* Check-Out */}
                  <div className="flex justify-between">
                    <span className="text-gray-500">Check-Out</span>
                    <span className="font-medium">
                      {timesheet.attendance.actual_checkout
                        ? formatTime(timesheet.attendance.actual_checkout)
                        : "—"}
                      {timesheet.attendance.checkout_status === "EARLY_DEPARTURE" && (
                        <span className="ml-1 text-amber-600 text-xs">(Early)</span>
                      )}
                      {timesheet.attendance.checkout_status === "LATE_DEPARTURE" && (
                        <span className="ml-1 text-amber-600 text-xs">(Late)</span>
                      )}
                    </span>
                  </div>

                  {/* Verification items */}
                  <div className="flex justify-between">
                    <span className="text-gray-500">QR</span>
                    <span className={`font-medium ${timesheet.attendance.qr_verified ? "text-green-600" : "text-gray-400"}`}>
                      {timesheet.attendance.qr_verified ? "✓ Verified" : "—"}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-500">GPS</span>
                    <span className="font-medium">
                      {timesheet.attendance.checkin_distance_metres != null
                        ? `✓ ${timesheet.attendance.checkin_distance_metres}m`
                        : "—"}
                    </span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-gray-500">Selfie</span>
                    <span className={`font-medium ${timesheet.attendance.selfie_photo_path ? "text-green-600" : "text-gray-400"}`}>
                      {timesheet.attendance.selfie_photo_path ? "✓ Submitted" : "—"}
                    </span>
                  </div>

                  {/* Exceptions */}
                  {timesheet.attendance.exceptions.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {timesheet.attendance.exceptions.map((exc) => (
                        <span
                          key={exc.id}
                          className={`text-xs px-2 py-0.5 rounded-full ${
                            exc.status === "PENDING"
                              ? "bg-amber-100 text-amber-700"
                              : exc.status === "APPROVED"
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {exc.exception_type === "LATE_ARRIVAL" ? `${exc.difference_minutes || 0}m late` :
                           exc.exception_type === "EARLY_DEPARTURE" ? `Left ${exc.difference_minutes || 0}m early` :
                           exc.exception_type === "LATE_DEPARTURE" ? `${exc.difference_minutes || 0}m overtime` :
                           exc.exception_type === "GPS_OUT_OF_RANGE" ? `GPS ${exc.difference_metres || 0}m` :
                           exc.exception_type.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* View Evidence link */}
                  <Link
                    href={`/admin/attendance/${timesheet.attendance.id}`}
                    className="block w-full bg-blue-50 text-blue-700 rounded-lg py-2 text-xs font-medium hover:bg-blue-100 transition-colors text-center mt-1"
                  >
                    👁 View Attendance Evidence
                  </Link>
                </>
              ) : (
                <p className="text-gray-400 text-xs italic">No attendance record for this shift.</p>
              )}
            </div>

            {/* Shift Work Times (separate from attendance) */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
              <h2 className="font-semibold text-gray-900">⏱ Shift</h2>
              <div className="flex justify-between">
                <span className="text-gray-500">Start</span>
                <span className="font-medium">{formatTime(timesheet.actual_start)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Finish</span>
                <span className="font-medium">{formatTime(timesheet.actual_finish)}</span>
              </div>
            </div>

            {/* Approved Payable Time */}
            {timesheet.attendance && (timesheet.attendance.approved_start || timesheet.attendance.approved_finish) && (
              <div className="bg-green-50 rounded-lg p-4 space-y-2 text-sm border border-green-200">
                <h2 className="font-semibold text-green-900">✓ Approved Payable Time</h2>
                <div className="flex justify-between">
                  <span className="text-green-700">Start</span>
                  <span className="font-medium text-green-900">
                    {timesheet.attendance.approved_start
                      ? formatTime(timesheet.attendance.approved_start)
                      : formatTime(timesheet.actual_start)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-green-700">Finish</span>
                  <span className="font-medium text-green-900">
                    {timesheet.attendance.approved_finish
                      ? formatTime(timesheet.attendance.approved_finish)
                      : formatTime(timesheet.actual_finish)}
                  </span>
                </div>
              </div>
            )}

            {/* Task Proof */}
            {proofReqs.length > 0 && (
              <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-gray-900">📷 Task Proof</h2>
                  {(() => {
                    const requiredReqs = proofReqs.filter((r) => r.is_required);
                    const completedReqs = requiredReqs.filter((r) => {
                      const count = proofSubs.filter((s) => s.proof_type === r.proof_type).length;
                      return count >= r.minimum_photos;
                    });
                    const allComplete = completedReqs.length >= requiredReqs.length;
                    return allComplete ? (
                      <span className="text-green-600 font-medium text-xs">✓ Submitted</span>
                    ) : (
                      <span className="text-amber-600 font-medium text-xs">⚠ Missing</span>
                    );
                  })()}
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Photos</span>
                  <span className="font-medium">{proofSubs.length}</span>
                </div>
                {proofSubs.length > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Submitted</span>
                    <span className="font-medium">
                      {formatTime(proofSubs[proofSubs.length - 1].server_timestamp)}
                    </span>
                  </div>
                )}
                <button
                  onClick={() => setShowProofGallery(!showProofGallery)}
                  className="w-full bg-blue-50 text-blue-700 rounded-lg py-2 text-xs font-medium hover:bg-blue-100 transition-colors mt-1"
                >
                  {showProofGallery ? "Hide Proof" : proofSubs.length > 0 ? "👁 View Task Proof" : "📋 View Requirements"}
                </button>

                {showProofGallery && (
                  <div className="mt-2 space-y-3">
                    {proofReqs.map((req) => {
                      const reqSubs = proofSubs.filter((s) => s.proof_type === req.proof_type);
                      const labels: Record<string, string> = { BEFORE: "Before Work", DURING: "During Work", AFTER: "After Work", OTHER: "Other" };
                      return (
                        <div key={req.id} className="border-t border-gray-200 pt-2">
                          <div className="text-xs font-semibold text-gray-700 mb-1">
                            {labels[req.proof_type] || req.proof_type}
                            {reqSubs.length === 0 && req.is_required && (
                              <span className="ml-1 text-red-500">⚠ Missing</span>
                            )}
                          </div>
                          {reqSubs.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {reqSubs.map((sub) => (
                                <div key={sub.id} className="space-y-1">
                                  {sub.photo_url ? (
                                    <img
                                      src={sub.photo_url}
                                      alt={`${sub.proof_type} proof`}
                                      className="w-20 h-20 object-cover rounded-lg border border-gray-200 cursor-pointer"
                                      onClick={() => window.open(sub.photo_url!, "_blank")}
                                    />
                                  ) : (
                                    <div className="w-20 h-20 bg-gray-200 rounded-lg flex items-center justify-center text-xs text-gray-400">📷</div>
                                  )}
                                  <div className="text-xs text-gray-400">
                                    {new Date(sub.server_timestamp).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true })}
                                  </div>
                                  {sub.status === "CORRECTION_REQUIRED" ? (
                                    <div className="text-xs text-red-500 font-medium">⚠ Correction sent</div>
                                  ) : (
                                    <button
                                      onClick={async () => {
                                        const reason = prompt("Why does this photo need correction?");
                                        if (!reason) return;
                                        const res = await fetch(`/api/task-proof/${sub.id}/correct`, {
                                          method: "POST",
                                          headers: { "Content-Type": "application/json" },
                                          body: JSON.stringify({ reason }),
                                        });
                                        if (res.ok) loadData();
                                      }}
                                      className="text-xs text-orange-600 hover:underline"
                                    >
                                      ⚠ Needs correction
                                    </button>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs text-gray-400 italic">No photos submitted</div>
                          )}
                          {reqSubs.some((s) => s.employee_note) && (
                            <div className="mt-1 text-xs text-gray-600 italic">
                              &ldquo;{reqSubs.find((s) => s.employee_note)?.employee_note}&rdquo;
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Hours & Distance */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
              <h2 className="font-semibold text-gray-900">Hours & Distance</h2>
              <div className="flex justify-between">
                <span className="text-gray-500">Hours Worked</span>
                <span className="font-medium">{formatDuration(timesheet.worked_minutes)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Start Odometer</span>
                <span className="font-medium">{timesheet.start_odometer.toLocaleString()} km</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Finish Odometer</span>
                <span className="font-medium">{timesheet.finish_odometer.toLocaleString()} km</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Distance</span>
                <span className="font-medium">{timesheet.distance_km} km</span>
              </div>
            </div>

            {/* Payment Breakdown */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
              <h2 className="font-semibold text-gray-900">Payment Breakdown</h2>
              <div className="flex justify-between">
                <span className="text-gray-500">Rate</span>
                <span className="font-medium">${timesheet.hourly_rate_snapshot.toFixed(2)}/hr</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Wages</span>
                <span className="font-medium">${timesheet.wage_amount.toFixed(2)}</span>
              </div>
              <hr className="my-1" />
              <div className="flex justify-between">
                <span className="text-gray-500">Mileage Rate</span>
                <span className="font-medium">${timesheet.mileage_rate_snapshot.toFixed(2)}/km</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Mileage</span>
                <span className="font-medium">${timesheet.mileage_amount.toFixed(2)}</span>
              </div>
              <hr className="my-1" />
              <div className="flex justify-between font-bold">
                <span>Estimated Total</span>
                <span className="text-green-600">${timesheet.total_amount.toFixed(2)}</span>
              </div>
              {timesheet.approved_total !== null && (
                <div className="flex justify-between font-bold">
                  <span>Approved Total</span>
                  <span className="text-blue-600">${timesheet.approved_total.toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Action buttons — for submitted and correction_submitted timesheets */}
            {(timesheet.status === "submitted" || timesheet.status === "correction_submitted") && (
              <div className="flex gap-3">
                <button
                  onClick={openCorrectionModal}
                  disabled={acting}
                  className="flex-1 bg-orange-500 text-white rounded-lg py-3 text-sm font-bold
                             hover:bg-orange-600 disabled:opacity-50 transition-colors"
                >
                  {acting ? "…" : "⚠️ Needs Correction"}
                </button>
                <button
                  onClick={handleApprove}
                  disabled={acting}
                  className="flex-1 bg-green-600 text-white rounded-lg py-3 text-sm font-bold
                             hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {acting ? "…" : "✅ Approve"}
                </button>
              </div>
            )}

            {timesheet.status === "approved" && (
              <p className="text-center text-sm text-green-600 font-medium">
                ✅ This timesheet has been approved.
              </p>
            )}
            {timesheet.status === "correction_required" && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-center">
                <p className="text-sm text-orange-700 font-medium">
                  ⏳ Waiting for employee to submit correction.
                </p>
              </div>
            )}
            {timesheet.status === "needs_correction" && (
              <p className="text-center text-sm text-orange-600 font-medium">
                ⚠️ This timesheet needs correction.
              </p>
            )}
          </>
        )}

        {/* Correction History */}
        {corrections.length > 0 && (
          <div className="pt-2 border-t border-gray-100">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-sm text-blue-600 hover:underline"
            >
              {showHistory ? "Hide" : "View"} Correction History ({corrections.length} round{corrections.length !== 1 ? "s" : ""})
            </button>

            {showHistory && (
              <div className="mt-3 space-y-3">
                {corrections.map((c) => (
                  <div key={c.id} className="bg-gray-50 rounded-lg p-4 text-sm">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-gray-900">Round {c.correction_round}</span>
                      <StatusBadge status={c.status} />
                    </div>
                    <div className="space-y-1 text-gray-600">
                      <div>
                        <span className="font-medium">Fields: </span>
                        {c.requested_fields.map((f) => FIELD_LABELS[f] || f).join(", ")}
                      </div>
                      <div>
                        <span className="font-medium">Admin note: </span>
                        &ldquo;{c.admin_note}&rdquo;
                      </div>
                      {c.employee_note && (
                        <div>
                          <span className="font-medium">Employee note: </span>
                          &ldquo;{c.employee_note}&rdquo;
                        </div>
                      )}
                      <div className="text-xs text-gray-400">
                        Requested: {new Date(c.requested_at).toLocaleString("en-AU")}
                        {c.submitted_at && ` · Submitted: ${new Date(c.submitted_at).toLocaleString("en-AU")}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Needs Correction Modal ── */}
      {showCorrectionModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">Needs Correction</h2>
                <button
                  onClick={() => setShowCorrectionModal(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                {timesheet.employee?.full_name} — {formatDateTime(timesheet.actual_start)}
              </p>

              {/* Field checkboxes */}
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-2">
                  What needs correction?
                </h3>
                <div className="space-y-2">
                  {CORRECTABLE_FIELDS.map((field) => (
                    <label
                      key={field.key}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedFields.includes(field.key)
                          ? "border-orange-300 bg-orange-50"
                          : "border-gray-200 hover:bg-gray-50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedFields.includes(field.key)}
                        onChange={() => toggleField(field.key)}
                        className="accent-orange-500 w-4 h-4"
                      />
                      <span className="text-sm text-gray-700">{field.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Admin note */}
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-2">
                  Note to Employee <span className="text-red-500">*</span>
                </h3>
                <textarea
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  rows={3}
                  placeholder="Please check your finish time and ending odometer. The reading does not appear to match your submission."
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                             focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>

              {correctionError && (
                <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">
                  {correctionError}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setShowCorrectionModal(false)}
                  className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm
                             font-medium hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={sendCorrectionRequest}
                  disabled={acting}
                  className="flex-1 bg-orange-500 text-white rounded-lg py-2.5 text-sm font-bold
                             hover:bg-orange-600 disabled:opacity-50 transition-colors"
                >
                  {acting ? "Sending…" : "Send to Employee"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* Comparison row component */
function ComparisonRow({
  label,
  before,
  after,
  changed,
}: {
  label: string;
  before: string;
  after: string;
  changed: boolean;
}) {
  return (
    <tr>
      <td className="py-2 pr-4 text-gray-600">{label}</td>
      <td className="py-2 px-2 text-right font-medium text-gray-500">{before}</td>
      <td className={`py-2 pl-2 text-right font-medium ${changed ? "text-blue-600 bg-blue-50 rounded" : "text-gray-700"}`}>
        {after}
        {changed && <span className="ml-1 text-xs">✎</span>}
      </td>
    </tr>
  );
}
