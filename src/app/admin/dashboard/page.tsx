"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface DashboardStats {
  totalEmployees: number;
  activeEmployees: number;
  pendingShifts: number;
  todayShifts: number;
  submittedTimesheets: number;
  unpaidPayments: number;
  unpaidAmount: number;
  attendanceReview: number;
}

interface UpcomingEvent {
  id: string;
  name: string;
  event_date: string;
  start_time: string;
  finish_time: string;
  status: string;
  event_staffing_requirements: {
    required_count: number;
    filled_count: number;
  }[];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard/admin").then((r) => r.json()),
      fetch("/api/events?upcoming=true").then((r) => r.json()),
    ]).then(([dashData, eventsData]) => {
      if (!dashData.error) setStats(dashData);
      if (Array.isArray(eventsData)) setUpcomingEvents(eventsData);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading dashboard…</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Admin Dashboard</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Link
          href="/admin/employees"
          className="bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 transition-colors"
        >
          <div className="text-3xl font-bold text-blue-600">{stats?.activeEmployees || 0}</div>
          <div className="text-sm text-gray-500 mt-1">Active Employees</div>
        </Link>

        <Link
          href="/admin/roster"
          className="bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 transition-colors"
        >
          <div className="text-3xl font-bold text-yellow-600">{stats?.pendingShifts || 0}</div>
          <div className="text-sm text-gray-500 mt-1">Pending Shifts</div>
        </Link>

        <Link
          href="/admin/timesheets"
          className="bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 transition-colors"
        >
          <div className="text-3xl font-bold text-orange-600">{stats?.submittedTimesheets || 0}</div>
          <div className="text-sm text-gray-500 mt-1">Timesheets to Review</div>
        </Link>

        <Link
          href="/admin/payments"
          className="bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 transition-colors"
        >
          <div className="text-3xl font-bold text-red-600">{stats?.unpaidPayments || 0}</div>
          <div className="text-sm text-gray-500 mt-1">Unpaid Payments</div>
          {(stats?.unpaidAmount || 0) > 0 && (
            <div className="text-xs text-gray-400 mt-1">${stats!.unpaidAmount.toFixed(2)} total</div>
          )}
        </Link>
      </div>

      {/* Attendance Review */}
      {(stats?.attendanceReview || 0) > 0 && (
        <Link
          href="/admin/attendance"
          className="block bg-amber-50 rounded-xl border border-amber-200 p-4 mb-4 hover:border-amber-400 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚠</span>
              <h2 className="font-semibold text-amber-800">Attendance Review</h2>
            </div>
            <span className="text-2xl font-bold text-amber-600">{stats!.attendanceReview}</span>
          </div>
          <div className="text-xs text-amber-600 mt-1">
            {stats!.attendanceReview} record{stats!.attendanceReview !== 1 ? "s" : ""} need{stats!.attendanceReview === 1 ? "s" : ""} review
          </div>
        </Link>
      )}

      {/* Today's Shifts */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Today&apos;s Shifts</h2>
          <span className="text-2xl font-bold text-purple-600">{stats?.todayShifts || 0}</span>
        </div>
      </div>

      {/* Upcoming Events */}
      {upcomingEvents.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Upcoming Events</h2>
            <Link href="/admin/events" className="text-xs text-blue-600 hover:underline">View all</Link>
          </div>
          <div className="space-y-2">
            {upcomingEvents.slice(0, 3).map((evt) => {
              const req = evt.event_staffing_requirements?.[0];
              const filled = req?.filled_count || 0;
              const required = req?.required_count || 0;
              const isFull = filled >= required;
              return (
                <Link
                  key={evt.id}
                  href={`/admin/events/${evt.id}`}
                  className="block p-3 rounded-lg border border-gray-100 hover:border-blue-200 hover:bg-blue-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-900">⚽ {evt.name}</div>
                      <div className="text-xs text-gray-500">
                        {new Date(evt.event_date + "T00:00:00").toLocaleDateString("en-AU", {
                          weekday: "short", day: "numeric", month: "short",
                        })}
                        {" · "}{formatTime(evt.start_time)} – {formatTime(evt.finish_time)}
                      </div>
                    </div>
                    {isFull ? (
                      <span className="text-xs font-medium text-green-600">✓ {filled}/{required}</span>
                    ) : (
                      <span className="text-xs font-medium text-amber-600">⚠ {filled}/{required}</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <h2 className="font-semibold text-gray-900 mb-3">Quick Actions</h2>
      <div className="space-y-2">
        <Link
          href="/admin/events/new"
          className="block bg-purple-50 rounded-lg p-3 text-sm font-medium text-purple-700 hover:bg-purple-100 transition-colors"
        >
          🎪 Event Staffing
        </Link>
        <Link
          href="/admin/shifts/new"
          className="block bg-blue-50 rounded-lg p-3 text-sm font-medium text-blue-700 hover:bg-blue-100 transition-colors"
        >
          ➕ Create New Shift
        </Link>
        <Link
          href="/admin/employees/new"
          className="block bg-green-50 rounded-lg p-3 text-sm font-medium text-green-700 hover:bg-green-100 transition-colors"
        >
          👤 Add New Employee
        </Link>
        <Link
          href="/admin/timesheets"
          className="block bg-orange-50 rounded-lg p-3 text-sm font-medium text-orange-700 hover:bg-orange-100 transition-colors"
        >
          📋 Review Timesheets
        </Link>
        <Link
          href="/admin/payments"
          className="block bg-purple-50 rounded-lg p-3 text-sm font-medium text-purple-700 hover:bg-purple-100 transition-colors"
        >
          💰 Manage Payments
        </Link>
        <Link
          href="/admin/attendance"
          className="block bg-amber-50 rounded-lg p-3 text-sm font-medium text-amber-700 hover:bg-amber-100 transition-colors"
        >
          📍 Attendance Review
        </Link>
        <Link
          href="/admin/task-proof-templates"
          className="block bg-gray-50 rounded-lg p-3 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
        >
          📷 Task Proof Templates
        </Link>
      </div>
    </div>
  );
}
