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
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/admin")
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) setStats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
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

      {/* Today's Shifts */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Today&apos;s Shifts</h2>
          <span className="text-2xl font-bold text-purple-600">{stats?.todayShifts || 0}</span>
        </div>
      </div>

      {/* Quick Actions */}
      <h2 className="font-semibold text-gray-900 mb-3">Quick Actions</h2>
      <div className="space-y-2">
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
      </div>
    </div>
  );
}
