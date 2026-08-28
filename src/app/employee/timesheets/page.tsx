"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";

interface Timesheet {
  id: string;
  actual_start: string;
  actual_finish: string;
  worked_minutes: number;
  distance_km: number;
  total_amount: number;
  approved_total: number | null;
  status: string;
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
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function EmployeeTimesheetsPage() {
  const [timesheets, setTimesheets] = useState<Timesheet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/timesheets")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setTimesheets(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading timesheets…</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Timesheets</h1>

      {timesheets.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500">No timesheets yet. Complete a shift to see your timesheets here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {timesheets.map((ts) => {
            const needsAction = ts.status === "correction_required";

            return (
              <Link
                key={ts.id}
                href={`/employee/timesheets/${ts.id}`}
                className={`block bg-white rounded-xl border p-4 transition-colors ${
                  needsAction
                    ? "border-orange-300 bg-orange-50 hover:border-orange-400"
                    : "border-gray-200 hover:border-blue-300"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">{formatDate(ts.actual_start)}</span>
                  <div className="flex items-center gap-2">
                    {needsAction && (
                      <span className="text-xs bg-orange-500 text-white px-2 py-0.5 rounded-full font-medium">
                        Action Required
                      </span>
                    )}
                    <StatusBadge status={ts.status} />
                  </div>
                </div>
                <div className="text-sm text-gray-500 space-y-1">
                  <div>
                    {formatTime(ts.actual_start)} – {formatTime(ts.actual_finish)} · {formatDuration(ts.worked_minutes)}
                  </div>
                  <div>{ts.distance_km} km driven</div>
                </div>
                <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between text-sm">
                  <span className="text-gray-500">
                    {ts.status === "approved" ? "Approved Total" : "Total"}
                  </span>
                  <span className="font-bold text-gray-900">
                    ${(ts.approved_total ?? ts.total_amount).toFixed(2)}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
