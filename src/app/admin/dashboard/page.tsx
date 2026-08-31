"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// ── Types ──────────────────────────────────────────────────

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

interface AttentionSummary {
  critical: number;
  warning: number;
  info: number;
  total: number;
}

interface AttentionItem {
  id: string;
  category: string;
  priority: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  description: string;
  employeeName?: string;
  actionUrl: string;
  createdAt: string;
}

// ── Icon Components ─────────────────────────────────────────

function EmployeesIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function CalendarIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function TimesheetIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="16" x2="13" y2="16" />
    </svg>
  );
}

function DollarIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="6" x2="12" y2="18" />
      <path d="M15.5 9.5c0-1.38-1.57-2.5-3.5-2.5S8.5 8.12 8.5 9.5 10.07 12 12 12s3.5 1.12 3.5 2.5-1.57 2.5-3.5 2.5-3.5-1.12-3.5-2.5" />
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

function AlertIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// ── Priority styles ─────────────────────────────────────────

const PRIORITY_STYLES = {
  CRITICAL: {
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-700",
    badge: "bg-red-100 text-red-800",
    dot: "bg-red-500",
  },
  WARNING: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    badge: "bg-amber-100 text-amber-800",
    dot: "bg-amber-500",
  },
  INFO: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-700",
    badge: "bg-blue-100 text-blue-800",
    dot: "bg-blue-500",
  },
};

// ── Dashboard Page ──────────────────────────────────────────

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [attention, setAttention] = useState<AttentionSummary | null>(null);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllAttention, setShowAllAttention] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard/admin").then((r) => r.json()),
      // Single combined call replaces two separate attention fetches
      fetch("/api/admin/attention?withSummary=true&limit=10").then((r) => r.json()),
    ]).then(([dashData, attData]) => {
      if (!dashData.error) setStats(dashData);
      if (!attData.error && attData.summary) {
        setAttention(attData.summary);
        setAttentionItems(attData.items || []);
      }
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
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {/* ── Attention Banner ── */}
      {attention && attention.total > 0 && (
        <div className={`rounded-2xl border p-4 ${
          attention.critical > 0
            ? "bg-red-50 border-red-200"
            : attention.warning > 0
              ? "bg-amber-50 border-amber-200"
              : "bg-blue-50 border-blue-200"
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                attention.critical > 0 ? "bg-red-100" : attention.warning > 0 ? "bg-amber-100" : "bg-blue-100"
              }`}>
                <AlertIcon className={`w-5 h-5 ${
                  attention.critical > 0 ? "text-red-600" : attention.warning > 0 ? "text-amber-600" : "text-blue-600"
                }`} />
              </div>
              <div>
                <h2 className="font-bold text-gray-900">Needs Attention</h2>
                <p className="text-xs text-gray-500">{attention.total} item{attention.total !== 1 ? "s" : ""} requiring action</p>
              </div>
            </div>
            <button
              onClick={() => setShowAllAttention(!showAllAttention)}
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              {showAllAttention ? "Show less" : "View all"}
            </button>
          </div>

          {/* Priority badges */}
          <div className="flex gap-2 mb-3">
            {attention.critical > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-800">
                🔴 {attention.critical} Critical
              </span>
            )}
            {attention.warning > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800">
                🟡 {attention.warning} Warning
              </span>
            )}
            {attention.info > 0 && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 text-blue-800">
                🔵 {attention.info} Info
              </span>
            )}
          </div>

          {/* Top items */}
          <div className="space-y-1.5">
            {(showAllAttention ? attentionItems : attentionItems.slice(0, 3)).map((item) => {
              const style = PRIORITY_STYLES[item.priority];
              return (
                <Link
                  key={item.id}
                  href={item.actionUrl}
                  className={`flex items-center justify-between p-2.5 rounded-xl border ${style.border} ${style.bg} hover:opacity-80 transition-opacity`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{item.title}</div>
                      <div className="text-xs text-gray-500 truncate">{item.description}</div>
                    </div>
                  </div>
                  <ChevronRightIcon />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TODAY Section ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center">
              <CalendarIcon className="w-5 h-5 text-blue-600" />
            </div>
            <h2 className="font-bold text-gray-900 text-lg">Today</h2>
          </div>
          <Link href="/admin/roster" className="text-xs font-medium text-blue-600 hover:underline">
            View Roster →
          </Link>
        </div>
        <div className="grid grid-cols-4 text-center gap-2">
          <TodayMetric label="Scheduled" value={stats?.todayShifts || 0} color="text-blue-600" />
          <TodayMetric label="Working" value={stats?.todayInProgress || 0} color="text-teal-600" />
          <TodayMetric label="Completed" value={stats?.todayCompleted || 0} color="text-green-600" />
          <TodayMetric label="No Show" value={stats?.todayNoShows || 0} color="text-red-600" />
        </div>
        {(stats?.todayShifts || 0) > 0 && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Assigned & waiting</span>
              <span className="font-semibold text-blue-600">{stats?.todayAssigned || 0}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── ROSTER Section ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-orange-50 rounded-xl flex items-center justify-center">
              <CalendarIcon className="w-5 h-5 text-orange-600" />
            </div>
            <h2 className="font-bold text-gray-900 text-lg">Roster</h2>
          </div>
          <Link href="/admin/roster" className="text-xs font-medium text-blue-600 hover:underline">
            Manage →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/admin/roster"
            className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:border-orange-200 hover:bg-orange-50/50 transition-colors"
          >
            <span className="text-sm text-gray-600">Pending Shifts</span>
            <span className="text-lg font-bold text-orange-600">{stats?.pendingShifts || 0}</span>
          </Link>
          <Link
            href="/admin/employees"
            className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:border-blue-200 hover:bg-blue-50/50 transition-colors"
          >
            <span className="text-sm text-gray-600">Active Staff</span>
            <span className="text-lg font-bold text-blue-600">{stats?.activeEmployees || 0}</span>
          </Link>
        </div>
      </div>

      {/* ── TIMESHEETS Section ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-green-50 rounded-xl flex items-center justify-center">
              <TimesheetIcon className="w-5 h-5 text-green-600" />
            </div>
            <h2 className="font-bold text-gray-900 text-lg">Timesheets</h2>
          </div>
          <Link href="/admin/timesheets" className="text-xs font-medium text-blue-600 hover:underline">
            Review →
          </Link>
        </div>
        <Link
          href="/admin/timesheets"
          className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:border-green-200 hover:bg-green-50/50 transition-colors"
        >
          <div>
            <div className="text-sm font-medium text-gray-900">Awaiting Approval</div>
            <div className="text-xs text-gray-400">Review and approve submitted timesheets</div>
          </div>
          <span className={`text-lg font-bold ${(stats?.submittedTimesheets || 0) > 0 ? "text-green-600" : "text-gray-300"}`}>
            {stats?.submittedTimesheets || 0}
          </span>
        </Link>
      </div>

      {/* ── PAYROLL Section ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-violet-50 rounded-xl flex items-center justify-center">
              <DollarIcon className="w-5 h-5 text-violet-600" />
            </div>
            <h2 className="font-bold text-gray-900 text-lg">Payroll</h2>
          </div>
          <Link href="/admin/payments" className="text-xs font-medium text-blue-600 hover:underline">
            Manage →
          </Link>
        </div>
        <Link
          href="/admin/payments"
          className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:border-violet-200 hover:bg-violet-50/50 transition-colors"
        >
          <div>
            <div className="text-sm font-medium text-gray-900">Unpaid</div>
            <div className="text-xs text-gray-400">
              {(stats?.unpaidAmount || 0) > 0
                ? `$${stats!.unpaidAmount.toFixed(2)} total outstanding`
                : "All caught up"}
            </div>
          </div>
          <span className={`text-lg font-bold ${(stats?.unpaidPayments || 0) > 0 ? "text-red-600" : "text-gray-300"}`}>
            {stats?.unpaidPayments || 0}
          </span>
        </Link>
      </div>

      {/* ── EVIDENCE Section ── */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-teal-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <h2 className="font-bold text-gray-900 text-lg">Evidence & Attendance</h2>
          </div>
        </div>
        <div className="space-y-1.5">
          <SnapshotRow
            href="/admin/attendance"
            label="Attendance Review"
            count={stats?.attendanceReview || 0}
            countColor="bg-blue-100 text-blue-700"
          />
          <SnapshotRow
            href="/admin/attendance"
            label="Site Issues"
            count={stats?.siteIssues || 0}
            countColor="bg-orange-100 text-orange-700"
          />
          <SnapshotRow
            href="/admin/task-proof-templates"
            label="Task Proof Pending"
            count={stats?.taskProofPending || 0}
            countColor="bg-green-100 text-green-700"
          />
          <Link
            href="/admin/photos"
            className="flex items-center justify-between py-2.5 px-1 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <span className="text-sm font-medium text-gray-700">📸 Manage Photos</span>
            <ChevronRightIcon />
          </Link>
        </div>
      </div>

      {/* ── Quick Actions ── */}
      <div>
        <h2 className="font-bold text-gray-900 text-lg mb-3">Quick Actions</h2>
        <div className="grid grid-cols-2 gap-3">
          <QuickAction
            href="/admin/shifts/new"
            icon="📅"
            iconBg="bg-blue-50"
            label="Create Shift"
            sublabel="Schedule a shift"
          />
          <QuickAction
            href="/admin/employees/new"
            icon="👤"
            iconBg="bg-green-50"
            label="Add Employee"
            sublabel="Onboard new staff"
          />
          <QuickAction
            href="/admin/timesheets"
            icon="📋"
            iconBg="bg-orange-50"
            label="Timesheets"
            sublabel="Review & approve"
          />
          <QuickAction
            href="/admin/payments"
            icon="💰"
            iconBg="bg-violet-50"
            label="Payments"
            sublabel="Process payments"
          />
          <QuickAction
            href="/admin/roster"
            icon="📊"
            iconBg="bg-teal-50"
            label="Roster"
            sublabel="Weekly view"
          />
          <QuickAction
            href="/admin/notification-settings"
            icon="🔔"
            iconBg="bg-amber-50"
            label="Notifications"
            sublabel="Alert settings"
          />
          <QuickAction
            href="/admin/employees"
            icon="👥"
            iconBg="bg-gray-50"
            label="Employees"
            sublabel="Manage staff"
          />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function TodayMetric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-2">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-[11px] text-gray-500 font-medium">{label}</div>
    </div>
  );
}

function SnapshotRow({
  href,
  label,
  count,
  countColor,
}: {
  href: string;
  label: string;
  count: number;
  countColor: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between py-2.5 px-1 hover:bg-gray-50 rounded-lg transition-colors"
    >
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
          count > 0 ? countColor : "bg-gray-100 text-gray-400"
        }`}>
          {count}
        </span>
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
  icon: string;
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
        <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center shrink-0 text-xl`}>
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900 truncate">{label}</div>
          <div className="text-xs text-gray-400 truncate">{sublabel}</div>
        </div>
      </div>
    </Link>
  );
}
