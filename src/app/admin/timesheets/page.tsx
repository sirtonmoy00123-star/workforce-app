"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";

interface Timesheet {
  id: string;
  shift_id: string;
  employee_id: string;
  actual_start: string;
  actual_finish: string;
  worked_minutes: number;
  distance_km: number;
  total_amount: number;
  approved_total: number | null;
  status: string;
  created_at: string;
  employee?: {
    full_name: string;
    employee_number: string;
  } | null;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export default function AdminTimesheetsPage() {
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    const url = filter === "all" ? "/api/timesheets" : `/api/timesheets?status=${filter}`;
    setLoading(true);
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setTimesheets(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [filter]);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Timesheets</h1>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {[
          { key: "all", label: "All" },
          { key: "submitted", label: "Pending Review" },
          { key: "correction_submitted", label: "Correction Submitted" },
          { key: "correction_required", label: "Awaiting Correction" },
          { key: "approved", label: "Approved" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              filter === tab.key
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading timesheets…</div>
      ) : timesheets.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500">No timesheets found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {timesheets.map((ts) => (
            <Link
              key={ts.id}
              href={`/admin/timesheets/${ts.id}`}
              className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-medium text-gray-900">
                    {ts.employee?.full_name || "Unknown"}
                  </span>
                  <span className="text-xs text-gray-400 ml-2">
                    {ts.employee?.employee_number}
                  </span>
                </div>
                <StatusBadge status={ts.status} />
              </div>
              <div className="flex items-center justify-between text-sm text-gray-500">
                <div>
                  {formatDate(ts.actual_start)} · {formatDuration(ts.worked_minutes)} · {ts.distance_km} km
                </div>
                <div className="font-medium text-gray-900">
                  ${(ts.approved_total ?? ts.total_amount).toFixed(2)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
