"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface PlatformStats {
  totalBusinesses: number;
  activeBusinesses: number;
  suspendedBusinesses: number;
  totalUsers: number;
  totalEmployees: number;
  totalShifts: number;
}

export default function PlatformHomePage() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/platform/stats")
      .then((res) => res.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-500">Loading platform stats…</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Platform Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Manage all businesses on the platform</p>
        </div>
        <Link
          href="/platform/businesses/new"
          className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium
                     hover:bg-emerald-700 transition-colors"
        >
          + Add Business
        </Link>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <StatCard label="Total Businesses" value={stats?.totalBusinesses || 0} color="blue" />
        <StatCard label="Active" value={stats?.activeBusinesses || 0} color="green" />
        <StatCard label="Suspended" value={stats?.suspendedBusinesses || 0} color="red" />
        <StatCard label="Total Users" value={stats?.totalUsers || 0} color="purple" />
        <StatCard label="Total Employees" value={stats?.totalEmployees || 0} color="indigo" />
        <StatCard label="Total Shifts" value={stats?.totalShifts || 0} color="amber" />
      </div>

      {/* Quick actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href="/platform/businesses/new"
            className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600 text-lg">
              +
            </div>
            <div>
              <div className="font-medium text-gray-900">Add New Business</div>
              <div className="text-sm text-gray-500">Create a business and its owner account</div>
            </div>
          </Link>
          <Link
            href="/platform/businesses"
            className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 text-lg">
              📋
            </div>
            <div>
              <div className="font-medium text-gray-900">View All Businesses</div>
              <div className="text-sm text-gray-500">Manage, suspend, or activate businesses</div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
    red: "bg-red-50 text-red-700",
    purple: "bg-purple-50 text-purple-700",
    indigo: "bg-indigo-50 text-indigo-700",
    amber: "bg-amber-50 text-amber-700",
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-sm text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${colorMap[color]?.split(" ")[1] || "text-gray-900"}`}>
        {value}
      </div>
    </div>
  );
}
