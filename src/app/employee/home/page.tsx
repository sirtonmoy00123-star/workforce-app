"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";

// ── Types ──────────────────────────────────────────────────

interface ShiftAction {
  action: string;
  label: string;
  href: string;
  variant: "primary" | "warning" | "success" | "info" | "muted";
  description: string;
  urgent: boolean;
}

interface ShiftWithAction {
  shiftId: string;
  date: string;
  scheduledStart: string;
  scheduledFinish: string;
  location: string | null;
  status: string;
  isToday: boolean;
  action: ShiftAction;
}

interface DashboardData {
  employeeName: string;
  upcomingShifts: { id: string; date: string; scheduled_start: string; scheduled_finish: string; location: string | null; status: string }[];
  activeShift: { actual_start: string; shift_id?: string; shifts?: { id: string } } | null;
  recentTimesheets: { id: string; actual_start: string; worked_minutes: number; total_amount: number; status: string }[];
  totalEarned: number;
  totalPaid: number;
  pendingPayment: number;
}

interface NextActionsData {
  today: ShiftWithAction[];
  upcoming: ShiftWithAction[];
}

// ── Helpers ────────────────────────────────────────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

// ── Variant styles ─────────────────────────────────────────

const ACTION_BUTTON_STYLES: Record<string, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800",
  warning: "bg-amber-500 text-white hover:bg-amber-600 active:bg-amber-700",
  success: "bg-green-600 text-white hover:bg-green-700 active:bg-green-800",
  info: "bg-gray-100 text-gray-700 hover:bg-gray-200",
  muted: "bg-gray-50 text-gray-400",
};

// ── Page Component ─────────────────────────────────────────

export default function EmployeeHomePage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [nextActions, setNextActions] = useState<NextActionsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/dashboard/employee").then((r) => r.json()),
      fetch("/api/employee/next-actions").then((r) => r.json()),
    ]).then(([dashData, actionsData]) => {
      if (!dashData.error) setData(dashData);
      if (!actionsData.error) setNextActions(actionsData);
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

  if (!data) {
    return <div className="text-center py-12 text-gray-500">Could not load dashboard.</div>;
  }

  const todayShifts = nextActions?.today || [];
  const upcomingShifts = nextActions?.upcoming || [];
  const hasActiveShift = data.activeShift !== null;
  const urgentAction = todayShifts.find((s) => s.action.urgent);

  return (
    <div className="space-y-4 pb-20">
      {/* ── Greeting ── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Hi, {data.employeeName.split(" ")[0]} 👋
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {todayShifts.length > 0
            ? `You have ${todayShifts.length} shift${todayShifts.length > 1 ? "s" : ""} today`
            : "No shifts scheduled today"}
        </p>
      </div>

      {/* ── Active Shift Banner ── */}
      {hasActiveShift && (
        <Link
          href={`/employee/shifts/${data.activeShift!.shift_id || data.activeShift!.shifts?.id}`}
          className="block bg-purple-50 border-2 border-purple-300 rounded-2xl p-4"
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
              <span className="text-2xl">🔴</span>
            </div>
            <div className="flex-1">
              <div className="font-bold text-purple-800 text-base">Shift In Progress</div>
              <div className="text-sm text-purple-600">
                Started at {formatTime(data.activeShift!.actual_start)}
              </div>
            </div>
            <div className="bg-purple-600 text-white text-sm font-semibold px-4 py-2 rounded-xl">
              Finish
            </div>
          </div>
        </Link>
      )}

      {/* ── Urgent Action ── */}
      {urgentAction && !hasActiveShift && (
        <Link
          href={urgentAction.action.href}
          className={`block rounded-2xl p-4 border-2 ${
            urgentAction.action.variant === "primary"
              ? "bg-blue-50 border-blue-300"
              : urgentAction.action.variant === "warning"
                ? "bg-amber-50 border-amber-300"
                : "bg-green-50 border-green-300"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              urgentAction.action.variant === "primary"
                ? "bg-blue-100"
                : urgentAction.action.variant === "warning"
                  ? "bg-amber-100"
                  : "bg-green-100"
            }`}>
              <span className="text-2xl">{
                urgentAction.action.action === "ACCEPT_DECLINE" ? "📬" :
                urgentAction.action.action === "CHECK_IN" ? "📍" :
                urgentAction.action.action === "START_SHIFT" ? "▶️" :
                urgentAction.action.action === "ADD_TASK_PROOF" ? "📸" : "⚡"
              }</span>
            </div>
            <div className="flex-1">
              <div className="font-bold text-gray-900">{urgentAction.action.label}</div>
              <div className="text-sm text-gray-600">{urgentAction.action.description}</div>
            </div>
            <div className={`text-sm font-semibold px-4 py-2 rounded-xl ${ACTION_BUTTON_STYLES[urgentAction.action.variant]}`}>
              Go
            </div>
          </div>
        </Link>
      )}

      {/* ── Earnings Summary ── */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-green-600">${data.totalPaid.toFixed(2)}</div>
          <div className="text-xs text-gray-500 mt-1">Total Paid</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <div className="text-2xl font-bold text-orange-600">${data.pendingPayment.toFixed(2)}</div>
          <div className="text-xs text-gray-500 mt-1">Pending Payment</div>
        </div>
      </div>

      {/* ── TODAY Section ── */}
      {todayShifts.length > 0 && (
        <div>
          <h2 className="font-bold text-gray-900 text-lg mb-2">Today</h2>
          <div className="space-y-2">
            {todayShifts.map((shift) => (
              <ShiftCard key={shift.shiftId} shift={shift} />
            ))}
          </div>
        </div>
      )}

      {/* ── UPCOMING Section ── */}
      {upcomingShifts.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-gray-900 text-lg">Upcoming</h2>
            <Link href="/employee/shifts" className="text-xs font-medium text-blue-600 hover:underline">
              View all →
            </Link>
          </div>
          <div className="space-y-2">
            {upcomingShifts.slice(0, 5).map((shift) => (
              <ShiftCard key={shift.shiftId} shift={shift} />
            ))}
          </div>
        </div>
      )}

      {/* ── PAST / Recent Timesheets ── */}
      {data.recentTimesheets.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-gray-900 text-lg">Recent</h2>
            <Link href="/employee/timesheets" className="text-xs font-medium text-blue-600 hover:underline">
              All timesheets →
            </Link>
          </div>
          <div className="space-y-2">
            {data.recentTimesheets.map((ts) => (
              <Link
                key={ts.id}
                href={`/employee/timesheets/${ts.id}`}
                className="flex items-center justify-between p-3 bg-white rounded-2xl border border-gray-200 hover:border-blue-200 transition-colors active:scale-[0.99]"
              >
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {new Date(ts.actual_start).toLocaleDateString("en-AU", {
                      weekday: "short", day: "numeric", month: "short",
                    })}
                  </div>
                  <div className="text-xs text-gray-500">{formatDuration(ts.worked_minutes)}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-gray-900">${ts.total_amount.toFixed(2)}</div>
                  <StatusBadge status={ts.status} />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Quick Links ── */}
      <div className="grid grid-cols-2 gap-3">
        <QuickLink href="/employee/offers" icon="🎪" label="Shift Offers" bg="bg-purple-50" />
        <QuickLink href="/employee/shifts" icon="📅" label="All Shifts" bg="bg-blue-50" />
        <QuickLink href="/employee/timesheets" icon="📋" label="Timesheets" bg="bg-orange-50" />
        <QuickLink href="/employee/payments" icon="💰" label="Payments" bg="bg-green-50" />
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

function ShiftCard({ shift }: { shift: ShiftWithAction }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-3.5 hover:border-blue-200 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-semibold text-gray-900">{formatDate(shift.date)}</div>
          <div className="text-xs text-gray-500">
            {formatTime(shift.scheduledStart)} – {formatTime(shift.scheduledFinish)}
            {shift.location && ` · ${shift.location}`}
          </div>
        </div>
        <StatusBadge status={shift.status} />
      </div>

      {/* Smart CTA */}
      {shift.action.action !== "NONE" && shift.action.action !== "WAITING" && (
        <Link
          href={shift.action.href}
          className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold transition-colors active:scale-[0.98] ${
            ACTION_BUTTON_STYLES[shift.action.variant]
          }`}
        >
          {shift.action.label}
          {shift.action.urgent && <span className="text-xs">⚡</span>}
        </Link>
      )}

      {shift.action.action === "NONE" && (
        <Link
          href={shift.action.href}
          className="flex items-center justify-center w-full py-2 rounded-xl text-xs font-medium text-gray-400 bg-gray-50"
        >
          {shift.action.description}
        </Link>
      )}
    </div>
  );
}

function QuickLink({ href, icon, label, bg }: { href: string; icon: string; label: string; bg: string }) {
  return (
    <Link
      href={href}
      className={`${bg} rounded-2xl p-4 text-center hover:opacity-80 transition-opacity active:scale-[0.98]`}
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className="text-sm font-medium text-gray-700">{label}</div>
    </Link>
  );
}
