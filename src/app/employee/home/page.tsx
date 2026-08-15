"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";

interface UpcomingShift {
  id: string;
  date: string;
  scheduled_start: string;
  scheduled_finish: string;
  location: string | null;
  status: string;
}

interface RecentTimesheet {
  id: string;
  actual_start: string;
  worked_minutes: number;
  estimated_total: number;
  status: string;
}

interface DashboardData {
  employeeName: string;
  upcomingShifts: UpcomingShift[];
  activeShift: { actual_start: string; shift_id?: string; shifts?: { id: string } } | null;
  recentTimesheets: RecentTimesheet[];
  totalEarned: number;
  totalPaid: number;
  pendingPayment: number;
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
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export default function EmployeeHomePage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/employee")
      .then((res) => res.json())
      .then((d) => {
        if (!d.error) setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;
  if (!data) return <div className="text-center py-12 text-gray-500">Could not load dashboard.</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">
        Welcome, {data.employeeName.split(" ")[0]}!
      </h1>
      <p className="text-sm text-gray-500 mb-6">Here&apos;s your overview.</p>

      {/* Active Shift Alert */}
      {data.activeShift && (
        <Link
          href={`/employee/shifts/${data.activeShift.shift_id || data.activeShift.shifts?.id}`}
          className="block bg-purple-50 border-2 border-purple-300 rounded-xl p-4 mb-4 animate-pulse"
        >
          <div className="flex items-center gap-2">
            <span className="text-lg">🔴</span>
            <div>
              <div className="font-bold text-purple-800">Shift In Progress</div>
              <div className="text-sm text-purple-600">
                Started at {formatTime(data.activeShift.actual_start)} — Tap to finish
              </div>
            </div>
          </div>
        </Link>
      )}

      {/* Earnings Summary */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-green-600">${data.totalPaid.toFixed(2)}</div>
          <div className="text-xs text-gray-500 mt-1">Total Paid</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-orange-600">${data.pendingPayment.toFixed(2)}</div>
          <div className="text-xs text-gray-500 mt-1">Pending Payment</div>
        </div>
      </div>

      {/* Upcoming Shifts */}
      <h2 className="font-semibold text-gray-900 mb-3">Upcoming Shifts</h2>
      {data.upcomingShifts.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 text-center">
          <p className="text-sm text-gray-500">No upcoming shifts.</p>
        </div>
      ) : (
        <div className="space-y-2 mb-6">
          {data.upcomingShifts.map((shift) => (
            <Link
              key={shift.id}
              href={`/employee/shifts/${shift.id}`}
              className="block bg-white rounded-xl border border-gray-200 p-3 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm text-gray-900">{formatDate(shift.date)}</div>
                  <div className="text-xs text-gray-500">
                    {formatTime(shift.scheduled_start)} – {formatTime(shift.scheduled_finish)}
                    {shift.location && ` · ${shift.location}`}
                  </div>
                </div>
                <StatusBadge status={shift.status} />
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Recent Timesheets */}
      <h2 className="font-semibold text-gray-900 mb-3">Recent Timesheets</h2>
      {data.recentTimesheets.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 text-center">
          <p className="text-sm text-gray-500">No timesheets yet.</p>
        </div>
      ) : (
        <div className="space-y-2 mb-6">
          {data.recentTimesheets.map((ts) => (
            <div
              key={ts.id}
              className="bg-white rounded-xl border border-gray-200 p-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {new Date(ts.actual_start).toLocaleDateString("en-AU", {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </div>
                  <div className="text-xs text-gray-500">{formatDuration(ts.worked_minutes)}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-gray-900">${ts.estimated_total.toFixed(2)}</div>
                  <StatusBadge status={ts.status} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick Links */}
      <div className="space-y-2">
        <Link
          href="/employee/shifts"
          className="block bg-blue-50 rounded-lg p-3 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
        >
          📅 View All Shifts
        </Link>
        <Link
          href="/employee/timesheets"
          className="block bg-orange-50 rounded-lg p-3 text-sm font-medium text-orange-700 hover:bg-orange-100 transition-colors"
        >
          📋 View Timesheets
        </Link>
        <Link
          href="/employee/payments"
          className="block bg-green-50 rounded-lg p-3 text-sm font-medium text-green-700 hover:bg-green-100 transition-colors"
        >
          💰 View Payments
        </Link>
      </div>
    </div>
  );
}
