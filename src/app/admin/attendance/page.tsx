"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface AttendanceRecord {
  id: string;
  shift_id: string;
  employee_id: string;
  scheduled_start: string;
  scheduled_finish: string;
  actual_checkin: string | null;
  actual_checkout: string | null;
  checkin_status: string;
  checkout_status: string;
  qr_verified: boolean;
  checkin_distance_metres: number | null;
  verification_status: string;
  requires_review: boolean;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  employees: { id: string; full_name: string; employee_number: string };
  work_locations: { id: string; name: string } | null;
  shifts: { id: string; date: string; location: string | null };
  exceptions: AttendanceException[];
}

interface AttendanceException {
  id: string;
  exception_type: string;
  difference_minutes: number | null;
  difference_metres: number | null;
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
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function getStatusColor(status: string): string {
  switch (status) {
    case "PRESENT": return "text-green-700 bg-green-50 border-green-200";
    case "LATE": return "text-amber-700 bg-amber-50 border-amber-200";
    case "NEEDS_REVIEW": return "text-red-700 bg-red-50 border-red-200";
    case "APPROVED_MANUALLY": return "text-blue-700 bg-blue-50 border-blue-200";
    case "ABSENT": return "text-gray-700 bg-gray-50 border-gray-200";
    default: return "text-gray-700 bg-gray-50 border-gray-200";
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "PRESENT": return "✓ Present";
    case "LATE": return "⚠ Late";
    case "NEEDS_REVIEW": return "⚠ Needs Review";
    case "APPROVED_MANUALLY": return "✓ Approved";
    case "ABSENT": return "✗ Absent";
    case "NOT_CHECKED_IN": return "○ Not Checked In";
    default: return status;
  }
}

function getExceptionLabel(type: string, mins: number | null, metres: number | null): string {
  switch (type) {
    case "LATE_ARRIVAL": return `${mins || 0} min late`;
    case "EARLY_DEPARTURE": return `Left ${mins || 0} min early`;
    case "LATE_DEPARTURE": return `${mins || 0} min overtime`;
    case "GPS_OUT_OF_RANGE": return `GPS ${metres || 0}m away`;
    case "QR_MISMATCH": return "QR mismatch";
    case "MISSING_SELFIE": return "No selfie";
    case "MISSING_SITE_PHOTO": return "No site photo";
    default: return type;
  }
}

function getVerificationBadge(status: string): string {
  switch (status) {
    case "VERIFIED": return "✓ Verified";
    case "REJECTED": return "✗ Rejected";
    case "NEEDS_REVIEW": return "⏳ Pending Review";
    case "PENDING": return "○ Pending";
    default: return status;
  }
}

function getVerificationColor(status: string): string {
  switch (status) {
    case "VERIFIED": return "text-green-700 bg-green-50";
    case "REJECTED": return "text-red-700 bg-red-50";
    case "NEEDS_REVIEW": return "text-amber-700 bg-amber-50";
    default: return "text-gray-700 bg-gray-50";
  }
}

export default function AdminAttendancePage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"needs_review" | "all">("needs_review");
  const [total, setTotal] = useState(0);

  const fetchRecords = (f: "needs_review" | "all") => {
    setLoading(true);
    fetch(`/api/attendance/reviews?filter=${f}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.records) {
          setRecords(data.records);
          setTotal(data.total);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchRecords(filter);
  }, [filter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Attendance Review</h1>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setFilter("needs_review")}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            filter === "needs_review"
              ? "bg-amber-100 text-amber-800 border border-amber-300"
              : "bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200"
          }`}
        >
          ⚠ Needs Review
        </button>
        <button
          onClick={() => setFilter("all")}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
            filter === "all"
              ? "bg-blue-100 text-blue-800 border border-blue-300"
              : "bg-gray-100 text-gray-600 border border-gray-200 hover:bg-gray-200"
          }`}
        >
          All Records
        </button>
        <span className="self-center text-sm text-gray-500 ml-auto">
          {total} record{total !== 1 ? "s" : ""}
        </span>
      </div>

      {loading && (
        <div className="text-center py-12 text-gray-500">Loading attendance records…</div>
      )}

      {!loading && records.length === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">
            {filter === "needs_review" ? "✅" : "📋"}
          </div>
          <div className="text-gray-500">
            {filter === "needs_review"
              ? "No attendance records need review"
              : "No attendance records found"}
          </div>
        </div>
      )}

      {/* Record cards */}
      <div className="space-y-3">
        {records.map((record) => {
          const lateException = record.exceptions.find((e) => e.exception_type === "LATE_ARRIVAL");
          const gpsException = record.exceptions.find((e) => e.exception_type === "GPS_OUT_OF_RANGE");
          const pendingExceptions = record.exceptions.filter((e) => e.status === "PENDING");

          return (
            <Link
              key={record.id}
              href={`/admin/attendance/${record.id}`}
              className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
            >
              {/* Header: employee name + status */}
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-semibold text-gray-900">
                    {record.employees.full_name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {record.employees.employee_number}
                  </div>
                </div>
                <span
                  className={`text-xs font-medium px-2 py-1 rounded-full border ${getStatusColor(
                    record.checkin_status
                  )}`}
                >
                  {getStatusLabel(record.checkin_status)}
                </span>
              </div>

              {/* Shift info */}
              <div className="text-sm text-gray-600 mb-2">
                <span className="font-medium">{formatDate(record.shifts.date)}</span>
                {" · "}
                {formatTime(record.scheduled_start)} – {formatTime(record.scheduled_finish)}
              </div>

              {/* Location */}
              {record.work_locations && (
                <div className="text-xs text-gray-500 mb-2">
                  📍 {record.work_locations.name}
                </div>
              )}

              {/* Check-in info */}
              {record.actual_checkin && (
                <div className="text-xs text-gray-500 mb-2">
                  Checked in: {formatTime(record.actual_checkin)}
                  {record.checkin_distance_metres != null && (
                    <span> · {record.checkin_distance_metres}m from site</span>
                  )}
                </div>
              )}

              {/* Exceptions */}
              {record.exceptions.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {record.exceptions.map((exc) => (
                    <span
                      key={exc.id}
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        exc.status === "PENDING"
                          ? "bg-amber-100 text-amber-700"
                          : exc.status === "APPROVED"
                          ? "bg-green-100 text-green-700"
                          : exc.status === "REJECTED"
                          ? "bg-red-100 text-red-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {getExceptionLabel(exc.exception_type, exc.difference_minutes, exc.difference_metres)}
                    </span>
                  ))}
                </div>
              )}

              {/* Verification status + action hint */}
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                <span className={`text-xs px-2 py-0.5 rounded-full ${getVerificationColor(record.verification_status)}`}>
                  {getVerificationBadge(record.verification_status)}
                </span>
                {pendingExceptions.length > 0 && (
                  <span className="text-xs text-amber-600 font-medium">
                    {pendingExceptions.length} exception{pendingExceptions.length !== 1 ? "s" : ""} pending →
                  </span>
                )}
                {record.verification_status === "VERIFIED" && (
                  <span className="text-xs text-gray-400">Reviewed ✓</span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
