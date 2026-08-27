"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface AttendanceRecord {
  shift_id: string;
  employee_id: string;
  employee_name: string;
  employee_number: string;
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

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

type DateRange = "today" | "this_week" | "last_week" | "this_month" | "custom";

function getDateRange(range: DateRange): { start: string; end: string } {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (range === "today") {
    const today = fmt(now);
    return { start: today, end: today };
  }
  if (range === "this_week") {
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: fmt(monday), end: fmt(sunday) };
  }
  if (range === "last_week") {
    const dayOfWeek = now.getDay();
    const lastMonday = new Date(now);
    lastMonday.setDate(now.getDate() - ((dayOfWeek + 6) % 7) - 7);
    const lastSunday = new Date(lastMonday);
    lastSunday.setDate(lastMonday.getDate() + 6);
    return { start: fmt(lastMonday), end: fmt(lastSunday) };
  }
  // this_month
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: fmt(firstDay), end: fmt(lastDay) };
}

function getStatusBadge(status: string): { label: string; color: string } {
  switch (status) {
    case "PRESENT": return { label: "✓ Present", color: "text-green-700 bg-green-50" };
    case "APPROVED_MANUALLY": return { label: "✓ Approved", color: "text-blue-700 bg-blue-50" };
    case "LATE": return { label: "⚠ Late", color: "text-amber-700 bg-amber-50" };
    case "NOT_CHECKED_IN": return { label: "○ Not Checked In", color: "text-gray-500 bg-gray-50" };
    case "NEEDS_REVIEW": return { label: "⚠ Review", color: "text-red-700 bg-red-50" };
    default: return { label: status, color: "text-gray-500 bg-gray-50" };
  }
}

export default function AdminAttendanceReportsPage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const [dateRange, setDateRange] = useState<DateRange>("this_week");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");

  // Employee list for filter
  const [employees, setEmployees] = useState<{ id: string; full_name: string; employee_number: string }[]>([]);

  useEffect(() => {
    fetch("/api/employees")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setEmployees(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, customStart, customEnd, statusFilter, employeeFilter]);

  function loadReport() {
    let start: string, end: string;
    if (dateRange === "custom") {
      if (!customStart || !customEnd) return;
      start = customStart;
      end = customEnd;
    } else {
      const range = getDateRange(dateRange);
      start = range.start;
      end = range.end;
    }

    const params = new URLSearchParams({ startDate: start, endDate: end });
    if (statusFilter) params.set("status", statusFilter);
    if (employeeFilter) params.set("employeeId", employeeFilter);

    setLoading(true);
    fetch(`/api/attendance/reports?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.records) setRecords(data.records);
        if (data.summary) setSummary(data.summary);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Attendance Reports</h1>
        <Link
          href="/admin/attendance"
          className="text-sm text-blue-600 hover:underline"
        >
          Review Queue →
        </Link>
      </div>

      {/* Date Range Tabs */}
      <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
        {[
          { key: "today", label: "Today" },
          { key: "this_week", label: "This Week" },
          { key: "last_week", label: "Last Week" },
          { key: "this_month", label: "This Month" },
          { key: "custom", label: "Custom" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setDateRange(tab.key as DateRange)}
            className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              dateRange === tab.key
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Custom Date Inputs */}
      {dateRange === "custom" && (
        <div className="flex gap-2 mb-3">
          <input
            type="date"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <span className="self-center text-gray-400">–</span>
          <input
            type="date"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <select
          value={employeeFilter}
          onChange={(e) => setEmployeeFilter(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
        >
          <option value="">All Employees</option>
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.full_name} ({emp.employee_number})
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
        >
          <option value="">All Statuses</option>
          <option value="PRESENT">Present</option>
          <option value="LATE">Late</option>
          <option value="ABSENT">Absent</option>
          <option value="NEEDS_REVIEW">Needs Review</option>
        </select>
      </div>

      {/* Summary Cards */}
      {summary && !loading && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <div className="text-2xl font-bold text-gray-900">{summary.scheduled}</div>
            <div className="text-xs text-gray-500">Scheduled</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <div className="text-2xl font-bold text-green-600">{summary.present}</div>
            <div className="text-xs text-gray-500">Present</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <div className="text-2xl font-bold text-blue-600">{summary.attendanceRate}%</div>
            <div className="text-xs text-gray-500">Rate</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <div className="text-2xl font-bold text-amber-600">{summary.late}</div>
            <div className="text-xs text-gray-500">Late</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <div className="text-2xl font-bold text-red-600">{summary.absent}</div>
            <div className="text-xs text-gray-500">Absent</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <div className="text-2xl font-bold text-orange-600">{summary.needsReview}</div>
            <div className="text-xs text-gray-500">Needs Review</div>
          </div>
        </div>
      )}

      {/* Extra Stats */}
      {summary && !loading && (summary.totalLateMinutes > 0 || summary.earlyDepartures > 0 || summary.lateFinishes > 0) && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 space-y-1 text-sm">
          {summary.totalLateMinutes > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-500">Total Late</span>
              <span className="font-medium text-amber-600">{formatDuration(summary.totalLateMinutes)}</span>
            </div>
          )}
          {summary.earlyDepartures > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-500">Early Departures</span>
              <span className="font-medium text-amber-600">{summary.earlyDepartures}</span>
            </div>
          )}
          {summary.lateFinishes > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-500">Late Finishes</span>
              <span className="font-medium text-amber-600">{summary.lateFinishes}</span>
            </div>
          )}
          {summary.approvedExtraMinutes > 0 && (
            <div className="flex justify-between">
              <span className="text-gray-500">Approved Extra Time</span>
              <span className="font-medium text-green-600">{formatDuration(summary.approvedExtraMinutes)}</span>
            </div>
          )}
        </div>
      )}

      {/* Records */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading report…</div>
      ) : records.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📋</div>
          <div className="text-gray-500">No attendance records found for this period.</div>
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
                  <div>
                    <span className="font-medium text-gray-900 text-sm">{rec.employee_name}</span>
                    <span className="text-xs text-gray-400 ml-1">{rec.employee_number}</span>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.color}`}>
                    {badge.label}
                  </span>
                </div>
                <div className="text-sm text-gray-600 mb-1">
                  <span className="font-medium">{formatDate(rec.date)}</span>
                  {" · "}
                  {formatTime(rec.scheduled_start)} – {formatTime(rec.scheduled_finish)}
                  {rec.location && (
                    <span className="text-gray-400"> · {rec.location}</span>
                  )}
                </div>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span>
                    📥 {rec.checkin_time ? formatTime(rec.checkin_time) : "—"}
                  </span>
                  <span>
                    📤 {rec.checkout_time ? formatTime(rec.checkout_time) : "—"}
                  </span>
                  {rec.exceptions.length > 0 && (
                    <span className="text-amber-600">
                      {rec.exceptions.map((e) =>
                        e.type === "LATE_ARRIVAL" ? `${e.minutes}m late` :
                        e.type === "EARLY_DEPARTURE" ? `Left ${e.minutes}m early` :
                        e.type.replace(/_/g, " ")
                      ).join(", ")}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
