"use client";

import { useEffect, useState } from "react";

interface AttendanceRecord {
  shift_id: string;
  employee_id: string;
  date: string;
  scheduled_start: string;
  scheduled_finish: string;
  location: string | null;
  checkin_time: string | null;
  checkout_time: string | null;
  checkin_status: string;
  checkout_status: string;
  verification_status: string;
  approved_start: string | null;
  approved_finish: string | null;
  exceptions: { type: string; minutes: number | null; status: string }[];
}

interface Summary {
  scheduled: number;
  present: number;
  late: number;
  absent: number;
  earlyDepartures: number;
  lateFinishes: number;
  needsReview: number;
  totalLateMinutes: number;
  approvedExtraMinutes: number;
  attendanceRate: number;
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

function getMonthRange(): { start: string; end: string; label: string } {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const label = now.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
  return {
    start: `${firstDay.getFullYear()}-${pad(firstDay.getMonth() + 1)}-${pad(firstDay.getDate())}`,
    end: `${lastDay.getFullYear()}-${pad(lastDay.getMonth() + 1)}-${pad(lastDay.getDate())}`,
    label,
  };
}

function getStatusBadge(status: string): { label: string; color: string } {
  switch (status) {
    case "PRESENT": return { label: "✓ Present", color: "text-green-700 bg-green-50 border-green-200" };
    case "LATE": return { label: "⚠ Late", color: "text-amber-700 bg-amber-50 border-amber-200" };
    case "NOT_CHECKED_IN": return { label: "○ Not Checked In", color: "text-gray-500 bg-gray-50 border-gray-200" };
    case "NEEDS_REVIEW": return { label: "⚠ Review", color: "text-red-700 bg-red-50 border-red-200" };
    default: return { label: status, color: "text-gray-500 bg-gray-50 border-gray-200" };
  }
}

export default function EmployeeAttendancePage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [monthLabel, setMonthLabel] = useState("");

  useEffect(() => {
    const { start, end, label } = getMonthRange();
    setMonthLabel(label);

    fetch(`/api/attendance/reports?startDate=${start}&endDate=${end}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.records) setRecords(data.records);
        if (data.summary) setSummary(data.summary);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">My Attendance</h1>
      <p className="text-sm text-gray-500 mb-6">{monthLabel}</p>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-3 gap-2 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <div className="text-2xl font-bold text-green-600">{summary.present}</div>
            <div className="text-xs text-gray-500">Present</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <div className="text-2xl font-bold text-amber-600">{summary.late}</div>
            <div className="text-xs text-gray-500">Late</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <div className="text-2xl font-bold text-red-600">{summary.absent}</div>
            <div className="text-xs text-gray-500">Absent</div>
          </div>
        </div>
      )}

      {/* Attendance Rate */}
      {summary && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Attendance Rate</span>
            <span className={`text-xl font-bold ${
              summary.attendanceRate >= 90 ? "text-green-600" :
              summary.attendanceRate >= 75 ? "text-amber-600" : "text-red-600"
            }`}>
              {summary.attendanceRate}%
            </span>
          </div>
          <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                summary.attendanceRate >= 90 ? "bg-green-500" :
                summary.attendanceRate >= 75 ? "bg-amber-500" : "bg-red-500"
              }`}
              style={{ width: `${Math.min(summary.attendanceRate, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Attendance History */}
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Attendance History</h2>

      {records.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-3">📋</div>
          <div className="text-gray-500">No attendance records this month.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((rec) => {
            const badge = getStatusBadge(rec.checkin_status);
            return (
              <div
                key={rec.shift_id}
                className="bg-white rounded-xl border border-gray-200 p-4"
              >
                <div className="flex items-start justify-between mb-1">
                  <span className="font-medium text-gray-900 text-sm">
                    {formatDate(rec.date)}
                  </span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${badge.color}`}>
                    {badge.label}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mb-2">
                  Roster: {formatTime(rec.scheduled_start)} – {formatTime(rec.scheduled_finish)}
                  {rec.location && <span> · {rec.location}</span>}
                </div>
                <div className="flex gap-4 text-xs text-gray-600">
                  <span>
                    📥 Check-In: {rec.checkin_time ? formatTime(rec.checkin_time) : "—"}
                  </span>
                  <span>
                    📤 Check-Out: {rec.checkout_time ? formatTime(rec.checkout_time) : "—"}
                  </span>
                </div>
                {rec.exceptions.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {rec.exceptions.map((exc, i) => (
                      <span
                        key={i}
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          exc.status === "APPROVED"
                            ? "bg-green-100 text-green-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        {exc.type === "LATE_ARRIVAL" ? `${exc.minutes}m late` :
                         exc.type === "EARLY_DEPARTURE" ? `Left ${exc.minutes}m early` :
                         exc.type === "LATE_DEPARTURE" ? `${exc.minutes}m overtime` :
                         exc.type.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
                {rec.verification_status === "VERIFIED" && (
                  <div className="text-xs text-green-600 mt-1">✓ Employer Reviewed</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
