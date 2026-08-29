"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface DashboardStats {
  totalEmployees: number;
  activeEmployees: number;
  pendingShifts: number;
  todayShifts: number;
  todayAssigned: number;
  todayInProgress: number;
  todayCompleted: number;
  todayNoShows: number;
  submittedTimesheets: number;
  unpaidPayments: number;
  unpaidAmount: number;
  attendanceReview: number;
  siteIssues: number;
  taskProofPending: number;
  unreadNotifications: number;
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

// ── Icon Components ─────────────────────────────────────────

function EmployeesIcon({ className = "w-7 h-7" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function CalendarIcon({ className = "w-7 h-7" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function TimesheetIcon({ className = "w-7 h-7" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </svg>
  );
}

function DollarIcon({ className = "w-7 h-7" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="6" x2="12" y2="18" />
      <path d="M15.5 9.5c0-1.38-1.57-2.5-3.5-2.5S8.5 8.12 8.5 9.5 10.07 12 12 12s3.5 1.12 3.5 2.5-1.57 2.5-3.5 2.5-3.5-1.12-3.5-2.5" />
    </svg>
  );
}

function ShiftsIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="10" y1="14" x2="14" y2="14" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// ── Dashboard Page ──────────────────────────────────────────

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-[3px] border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-5">Admin Dashboard</h1>

      {/* ── Stats Cards (2×2) ── */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <StatCard
          href="/admin/employees"
          icon={<EmployeesIcon />}
          iconBg="bg-blue-50"
          iconColor="text-blue-500"
          value={stats?.activeEmployees || 0}
          label="Active Employees"
          valueColor="text-blue-600"
        />
        <StatCard
          href="/admin/roster"
          icon={<CalendarIcon />}
          iconBg="bg-orange-50"
          iconColor="text-orange-500"
          value={stats?.pendingShifts || 0}
          label="Pending Shifts"
          valueColor="text-orange-600"
        />
        <StatCard
          href="/admin/timesheets"
          icon={<TimesheetIcon />}
          iconBg="bg-green-50"
          iconColor="text-green-600"
          value={stats?.submittedTimesheets || 0}
          label="Timesheets to Review"
          valueColor="text-green-600"
        />
        <StatCard
          href="/admin/payments"
          icon={<DollarIcon />}
          iconBg="bg-red-50"
          iconColor="text-red-500"
          value={stats?.unpaidPayments || 0}
          label="Unpaid Payments"
          valueColor="text-red-600"
          subtitle={
            (stats?.unpaidAmount || 0) > 0
              ? `$${stats!.unpaidAmount.toFixed(2)} total`
              : undefined
          }
        />
      </div>

      {/* ── Today's Shifts ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
              <ShiftsIcon className="w-5 h-5 text-blue-600" />
            </div>
            <h2 className="font-bold text-gray-900 text-lg">Today&apos;s Shifts</h2>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-blue-600">{stats?.todayShifts || 0}</div>
            <div className="text-xs text-gray-400">Total Shifts</div>
          </div>
        </div>
        <div className="border-t border-gray-100 pt-3">
          <div className="grid grid-cols-4 text-center">
            <TodayMetric label="Assigned" value={stats?.todayAssigned || 0} color="text-blue-600" icon="👥" />
            <TodayMetric label="In Progress" value={stats?.todayInProgress || 0} color="text-teal-600" icon="✨" />
            <TodayMetric label="Completed" value={stats?.todayCompleted || 0} color="text-green-600" icon="✅" />
            <TodayMetric label="No Shows" value={stats?.todayNoShows || 0} color="text-red-600" icon="❌" />
          </div>
        </div>
      </div>

      {/* ── Operations Snapshot ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-5">
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div>
            <h2 className="font-bold text-gray-900 text-lg">Operations Snapshot</h2>
            <p className="text-xs text-gray-400">Key items that need your attention</p>
          </div>
        </div>
        <div className="mt-3 divide-y divide-gray-100">
          <SnapshotRow
            href="/admin/attendance"
            icon={<span className="text-lg">👥</span>}
            label="Attendance Review"
            count={stats?.attendanceReview || 0}
            countColor="bg-blue-100 text-blue-700"
          />
          <SnapshotRow
            href="/admin/attendance"
            icon={<span className="text-lg">⚠️</span>}
            label="Site Issues"
            count={stats?.siteIssues || 0}
            countColor="bg-orange-100 text-orange-700"
          />
          <SnapshotRow
            href="/admin/task-proof-templates"
            icon={<span className="text-lg">📷</span>}
            label="Task Proof Pending"
            count={stats?.taskProofPending || 0}
            countColor="bg-green-100 text-green-700"
          />
        </div>
      </div>

      {/* ── Upcoming Events ── */}
      {upcomingEvents.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-900 text-lg">Upcoming Events</h2>
            <Link href="/admin/events" className="text-xs text-blue-600 font-medium hover:underline">View all</Link>
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
                  className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:border-blue-200 hover:bg-blue-50/50 transition-colors"
                >
                  <div>
                    <div className="text-sm font-semibold text-gray-900">🎪 {evt.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {new Date(evt.event_date + "T00:00:00").toLocaleDateString("en-AU", {
                        weekday: "short", day: "numeric", month: "short",
                      })}
                      {" · "}{formatTime(evt.start_time)} – {formatTime(evt.finish_time)}
                    </div>
                  </div>
                  {isFull ? (
                    <span className="text-xs font-semibold text-green-600 bg-green-50 px-2.5 py-1 rounded-lg">✓ {filled}/{required}</span>
                  ) : (
                    <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg">⚠ {filled}/{required}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Quick Actions (2-column grid) ── */}
      <h2 className="font-bold text-gray-900 text-lg mb-3">Quick Actions</h2>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <QuickAction
          href="/admin/events/new"
          icon={<span className="text-2xl">🎪</span>}
          iconBg="bg-purple-50"
          label="Event Staffing"
          sublabel="Manage event teams"
        />
        <QuickAction
          href="/admin/shifts/new"
          icon={<span className="text-2xl">📅</span>}
          iconBg="bg-blue-50"
          label="Create New Shift"
          sublabel="Schedule a new shift"
        />
        <QuickAction
          href="/admin/employees/new"
          icon={<span className="text-2xl">👤</span>}
          iconBg="bg-green-50"
          label="Add New Employee"
          sublabel="Onboard new staff"
        />
        <QuickAction
          href="/admin/timesheets"
          icon={<span className="text-2xl">📋</span>}
          iconBg="bg-orange-50"
          label="Review Timesheets"
          sublabel="Approve timesheets"
        />
        <QuickAction
          href="/admin/payments"
          icon={<span className="text-2xl">💰</span>}
          iconBg="bg-violet-50"
          label="Manage Payments"
          sublabel="Process payments"
        />
        <QuickAction
          href="/admin/attendance"
          icon={<span className="text-2xl">📍</span>}
          iconBg="bg-teal-50"
          label="Attendance Review"
          sublabel="Review attendance logs"
        />
      </div>

    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function StatCard({
  href,
  icon,
  iconBg,
  iconColor,
  value,
  label,
  valueColor,
  subtitle,
}: {
  href: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  value: number;
  label: string;
  valueColor: string;
  subtitle?: string;
}) {
  return (
    <Link
      href={href}
      className="bg-white rounded-2xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all active:scale-[0.98]"
    >
      <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center mb-2 ${iconColor}`}>
        {icon}
      </div>
      <div className={`text-3xl font-bold ${valueColor}`}>{value}</div>
      <div className="text-sm text-gray-500 mt-0.5 leading-tight">{label}</div>
      {subtitle && <div className="text-xs text-gray-400 mt-0.5">{subtitle}</div>}
    </Link>
  );
}

function TodayMetric({ label, value, color, icon }: { label: string; value: number; color: string; icon: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-xs text-gray-500 font-medium">{label}</div>
      <div className="text-base">{icon}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}

function SnapshotRow({
  href,
  icon,
  label,
  count,
  countColor,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  count: number;
  countColor: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between py-3 hover:bg-gray-50 -mx-1 px-1 rounded-lg transition-colors"
    >
      <div className="flex items-center gap-3">
        {icon}
        <span className="text-sm font-medium text-gray-800">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${countColor}`}>{count}</span>
        <ChevronRightIcon />
      </div>
    </Link>
  );
}

function QuickAction({
  href,
  icon,
  iconBg,
  label,
  sublabel,
}: {
  href: string;
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  sublabel: string;
}) {
  return (
    <Link
      href={href}
      className="bg-white rounded-2xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all active:scale-[0.98]"
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center shrink-0`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">{label}</div>
          <div className="text-xs text-gray-400 truncate">{sublabel}</div>
        </div>
        <ChevronRightIcon />
      </div>
    </Link>
  );
}

