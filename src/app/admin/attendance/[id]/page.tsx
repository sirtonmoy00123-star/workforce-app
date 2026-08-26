"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface AttendanceDetail {
  record: {
    id: string;
    shift_id: string;
    employee_id: string;
    location_id: string;
    scheduled_start: string;
    scheduled_finish: string;
    actual_checkin: string | null;
    actual_checkout: string | null;
    approved_start: string | null;
    approved_finish: string | null;
    checkin_status: string;
    checkout_status: string;
    qr_mode: string | null;
    qr_verified: boolean;
    checkin_latitude: number | null;
    checkin_longitude: number | null;
    checkin_distance_metres: number | null;
    selfie_photo_path: string | null;
    site_photo_path: string | null;
    verification_status: string;
    requires_review: boolean;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_note: string | null;
    created_at: string;
    employees: { id: string; full_name: string; employee_number: string };
    work_locations: { id: string; name: string; latitude: number | null; longitude: number | null } | null;
    shifts: { id: string; date: string; location: string | null; scheduled_start: string; scheduled_finish: string; status: string };
  };
  exceptions: Array<{
    id: string;
    exception_type: string;
    difference_minutes: number | null;
    difference_metres: number | null;
    status: string;
    admin_note: string | null;
    resolved_at: string | null;
  }>;
  selfieUrl: string | null;
  sitePhotoUrl: string | null;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getExceptionLabel(type: string): string {
  switch (type) {
    case "LATE_ARRIVAL": return "Late Arrival";
    case "EARLY_DEPARTURE": return "Early Departure";
    case "LATE_DEPARTURE": return "Late Departure";
    case "GPS_OUT_OF_RANGE": return "GPS Out of Range";
    case "QR_MISMATCH": return "QR Mismatch";
    case "MISSING_SELFIE": return "Missing Selfie";
    case "MISSING_SITE_PHOTO": return "Missing Site Photo";
    default: return type;
  }
}

export default function AttendanceReviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<AttendanceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Review form state
  const [payableStartOption, setPayableStartOption] = useState<"scheduled" | "actual" | "custom">("scheduled");
  const [customStartTime, setCustomStartTime] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [showSelfie, setShowSelfie] = useState(false);
  const [showSitePhoto, setShowSitePhoto] = useState(false);

  useEffect(() => {
    fetch(`/api/attendance/reviews/${id}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.record) {
          setData(d);
          // Default payable start: actual if present, else scheduled
          if (d.record.actual_checkin) {
            const scheduled = new Date(d.record.scheduled_start);
            const actual = new Date(d.record.actual_checkin);
            // If employee was late, default to actual time
            if (actual > scheduled) {
              setPayableStartOption("actual");
            }
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const handleReview = async (action: "approve" | "reject") => {
    if (!data) return;

    setSubmitting(true);
    setError("");
    setSuccess("");

    // Calculate approved start time
    let approvedStart: string | null = null;
    if (action === "approve") {
      if (payableStartOption === "scheduled") {
        approvedStart = data.record.scheduled_start;
      } else if (payableStartOption === "actual") {
        approvedStart = data.record.actual_checkin;
      } else if (payableStartOption === "custom" && customStartTime) {
        // Build ISO from the shift date + custom time
        const shiftDate = data.record.shifts.date;
        const offset = new Date().getTimezoneOffset();
        const sign = offset <= 0 ? "+" : "-";
        const absMin = Math.abs(offset);
        const offH = String(Math.floor(absMin / 60)).padStart(2, "0");
        const offM = String(absMin % 60).padStart(2, "0");
        approvedStart = new Date(`${shiftDate}T${customStartTime}:00${sign}${offH}:${offM}`).toISOString();
      }
    }

    // Auto-resolve pending exceptions when approving
    const exceptionActions = data.exceptions
      .filter((e) => e.status === "PENDING")
      .map((e) => ({
        exceptionId: e.id,
        status: action === "approve" ? "NOTED" : "REJECTED",
      }));

    try {
      const res = await fetch(`/api/attendance/reviews/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          approvedStart,
          reviewNote: reviewNote || null,
          exceptionActions,
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        setError(result.error || "Failed to submit review.");
      } else {
        setSuccess(action === "approve" ? "Attendance approved ✓" : "Attendance rejected.");
        // Refresh data
        const refreshed = await fetch(`/api/attendance/reviews/${id}`).then((r) => r.json());
        if (refreshed.record) setData(refreshed);
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setSubmitting(false);
  };

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading attendance record…</div>;
  }

  if (!data) {
    return <div className="text-center py-12 text-gray-500">Attendance record not found.</div>;
  }

  const { record, exceptions } = data;
  const isReviewed = record.verification_status === "VERIFIED" || record.verification_status === "REJECTED";

  // Calculate lateness
  let minsLate = 0;
  if (record.actual_checkin && record.scheduled_start) {
    const diff = new Date(record.actual_checkin).getTime() - new Date(record.scheduled_start).getTime();
    minsLate = Math.max(0, Math.floor(diff / 60_000));
  }

  return (
    <div>
      <button
        onClick={() => router.push("/admin/attendance")}
        className="text-blue-600 text-sm mb-4 inline-block"
      >
        ← Back to Attendance
      </button>

      <h1 className="text-2xl font-bold text-gray-900 mb-1">Attendance Review</h1>
      <p className="text-sm text-gray-500 mb-6">{record.employees.full_name} · {record.employees.employee_number}</p>

      {/* Success / Error messages */}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 mb-4 text-sm">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Status badge */}
      <div className="mb-4">
        {record.verification_status === "VERIFIED" && (
          <span className="inline-block px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
            ✓ Verified
          </span>
        )}
        {record.verification_status === "REJECTED" && (
          <span className="inline-block px-3 py-1 bg-red-100 text-red-700 rounded-full text-sm font-medium">
            ✗ Rejected
          </span>
        )}
        {record.verification_status === "NEEDS_REVIEW" && (
          <span className="inline-block px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm font-medium">
            ⚠ Needs Review
          </span>
        )}
        {record.verification_status === "PENDING" && (
          <span className="inline-block px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-sm font-medium">
            ○ Pending
          </span>
        )}
      </div>

      {/* Shift Details Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <h2 className="font-semibold text-gray-900 mb-3">Shift Details</h2>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Scheduled Start</span>
            <span className="font-medium">{formatTime(record.scheduled_start)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Scheduled Finish</span>
            <span className="font-medium">{formatTime(record.scheduled_finish)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Location</span>
            <span className="font-medium">{record.work_locations?.name || record.shifts.location || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Date</span>
            <span className="font-medium">
              {new Date(record.shifts.date + "T00:00:00").toLocaleDateString("en-AU", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
        </div>
      </div>

      {/* Check-In Details Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <h2 className="font-semibold text-gray-900 mb-3">Check-In Details</h2>

        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Verified Check-In</span>
            <span className="font-medium">
              {record.actual_checkin ? formatTime(record.actual_checkin) : "—"}
            </span>
          </div>

          {minsLate > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-500">Late</span>
              <span className="font-medium text-amber-600">{minsLate} minutes</span>
            </div>
          )}

          <div className="flex justify-between items-center">
            <span className="text-gray-500">QR</span>
            <span className={`font-medium ${record.qr_verified ? "text-green-600" : "text-gray-400"}`}>
              {record.qr_verified ? "✓ Verified" : "—"}
              {record.qr_mode && <span className="text-xs text-gray-400 ml-1">({record.qr_mode})</span>}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-gray-500">GPS</span>
            <span className={`font-medium ${
              record.checkin_distance_metres != null
                ? record.checkin_distance_metres <= 100
                  ? "text-green-600"
                  : "text-amber-600"
                : "text-gray-400"
            }`}>
              {record.checkin_distance_metres != null
                ? `${record.checkin_distance_metres}m`
                : "—"}
            </span>
          </div>

          {/* Selfie */}
          <div className="flex justify-between items-center">
            <span className="text-gray-500">Selfie</span>
            {data.selfieUrl ? (
              <button
                onClick={() => setShowSelfie(!showSelfie)}
                className="text-blue-600 text-sm font-medium hover:underline"
              >
                {showSelfie ? "Hide" : "View"}
              </button>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </div>
          {showSelfie && data.selfieUrl && (
            <div className="mt-2">
              <img
                src={data.selfieUrl}
                alt="Check-in selfie"
                className="w-full max-w-[300px] rounded-lg border border-gray-200"
              />
            </div>
          )}

          {/* Site Photo */}
          <div className="flex justify-between items-center">
            <span className="text-gray-500">Site Photo</span>
            {data.sitePhotoUrl ? (
              <button
                onClick={() => setShowSitePhoto(!showSitePhoto)}
                className="text-blue-600 text-sm font-medium hover:underline"
              >
                {showSitePhoto ? "Hide" : "View"}
              </button>
            ) : (
              <span className="text-gray-400">—</span>
            )}
          </div>
          {showSitePhoto && data.sitePhotoUrl && (
            <div className="mt-2">
              <img
                src={data.sitePhotoUrl}
                alt="Site photo"
                className="w-full max-w-[300px] rounded-lg border border-gray-200"
              />
            </div>
          )}
        </div>
      </div>

      {/* Exceptions Card */}
      {exceptions.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <h2 className="font-semibold text-gray-900 mb-3">Exceptions</h2>

          <div className="space-y-2">
            {exceptions.map((exc) => (
              <div
                key={exc.id}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  exc.status === "PENDING"
                    ? "bg-amber-50 border-amber-200"
                    : exc.status === "APPROVED" || exc.status === "NOTED"
                    ? "bg-green-50 border-green-200"
                    : "bg-red-50 border-red-200"
                }`}
              >
                <div>
                  <div className="text-sm font-medium">
                    ⚠ {getExceptionLabel(exc.exception_type)}
                  </div>
                  <div className="text-xs text-gray-500">
                    {exc.difference_minutes != null && `${exc.difference_minutes} minutes`}
                    {exc.difference_metres != null && `${exc.difference_metres} metres`}
                  </div>
                </div>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    exc.status === "PENDING"
                      ? "bg-amber-100 text-amber-700"
                      : exc.status === "APPROVED" || exc.status === "NOTED"
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {exc.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Review Actions — only show if not already reviewed */}
      {!isReviewed && (
        <div className="bg-white rounded-xl border border-blue-200 p-4 mb-4">
          <h2 className="font-semibold text-gray-900 mb-3">Payable Start</h2>

          <div className="space-y-2 mb-4">
            <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="payableStart"
                value="scheduled"
                checked={payableStartOption === "scheduled"}
                onChange={() => setPayableStartOption("scheduled")}
                className="accent-blue-600"
              />
              <div>
                <div className="text-sm font-medium">Use Scheduled {formatTime(record.scheduled_start)}</div>
                <div className="text-xs text-gray-500">Pay from the originally scheduled start time</div>
              </div>
            </label>

            {record.actual_checkin && (
              <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
                <input
                  type="radio"
                  name="payableStart"
                  value="actual"
                  checked={payableStartOption === "actual"}
                  onChange={() => setPayableStartOption("actual")}
                  className="accent-blue-600"
                />
                <div>
                  <div className="text-sm font-medium">Use Actual {formatTime(record.actual_checkin)}</div>
                  <div className="text-xs text-gray-500">Pay from when they actually checked in</div>
                </div>
              </label>
            )}

            <label className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-50">
              <input
                type="radio"
                name="payableStart"
                value="custom"
                checked={payableStartOption === "custom"}
                onChange={() => setPayableStartOption("custom")}
                className="accent-blue-600"
              />
              <div className="flex-1">
                <div className="text-sm font-medium">Enter Approved Time</div>
                {payableStartOption === "custom" && (
                  <input
                    type="time"
                    value={customStartTime}
                    onChange={(e) => setCustomStartTime(e.target.value)}
                    className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                )}
              </div>
            </label>
          </div>

          {/* Admin Note */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Admin Note
            </label>
            <textarea
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Optional note about this review…"
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => handleReview("approve")}
              disabled={submitting}
              className="flex-1 bg-green-600 text-white font-semibold py-3 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? "Submitting…" : "✓ Approve"}
            </button>
            <button
              onClick={() => handleReview("reject")}
              disabled={submitting}
              className="flex-1 bg-red-600 text-white font-semibold py-3 rounded-xl hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {submitting ? "Submitting…" : "✗ Reject"}
            </button>
          </div>
        </div>
      )}

      {/* Already reviewed info */}
      {isReviewed && (
        <div className={`rounded-xl border p-4 mb-4 ${
          record.verification_status === "VERIFIED"
            ? "bg-green-50 border-green-200"
            : "bg-red-50 border-red-200"
        }`}>
          <h2 className="font-semibold text-gray-900 mb-2">
            {record.verification_status === "VERIFIED" ? "✓ Approved" : "✗ Rejected"}
          </h2>
          {record.reviewed_at && (
            <div className="text-sm text-gray-600 mb-1">
              Reviewed: {formatDateTime(record.reviewed_at)}
            </div>
          )}
          {record.approved_start && (
            <div className="text-sm text-gray-600 mb-1">
              Approved Start: {formatTime(record.approved_start)}
            </div>
          )}
          {record.review_note && (
            <div className="text-sm text-gray-600 mt-2">
              <span className="font-medium">Note:</span> {record.review_note}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
