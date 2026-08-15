"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";

interface TimesheetDetail {
  id: string;
  shift_id: string;
  employee_id: string;
  scheduled_start: string;
  scheduled_finish: string;
  actual_start: string;
  actual_finish: string;
  worked_minutes: number;
  start_odometer: number;
  finish_odometer: number;
  distance_km: number;
  hourly_rate_snapshot: number;
  mileage_rate_snapshot: number;
  wage_amount: number;
  mileage_amount: number;
  estimated_total: number;
  approved_total: number | null;
  status: string;
  created_at: string;
  employee?: { full_name: string; employee_number: string } | null;
  shift_location: string | null;
  odometer_submissions: Array<{
    id: string;
    submission_type: string;
    photo_path: string;
    odometer_reading: number;
    server_timestamp: string;
  }>;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

export default function AdminTimesheetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [timesheet, setTimesheet] = useState<TimesheetDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetch(`/api/timesheets/${id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setTimesheet(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load timesheet.");
        setLoading(false);
      });
  }, [id]);

  async function handleAction(action: "approve" | "needs_correction") {
    setActing(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/timesheets/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Action failed.");
      } else {
        setTimesheet((prev) => prev ? { ...prev, status: data.status } : prev);
        setSuccess(action === "approve" ? "Timesheet approved!" : "Timesheet marked as needs correction.");
      }
    } catch {
      setError("Something went wrong.");
    }
    setActing(false);
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;
  if (!timesheet) return <div className="text-center py-12 text-red-500">{error || "Timesheet not found."}</div>;

  return (
    <div className="max-w-2xl mx-auto">
      <button
        onClick={() => router.push("/admin/timesheets")}
        className="text-sm text-blue-600 hover:underline mb-4 inline-block"
      >
        ← Back to Timesheets
      </button>

      {success && (
        <div className="bg-green-50 text-green-700 text-sm rounded-lg p-3 border border-green-200 mb-4">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Timesheet Review</h1>
            <p className="text-sm text-gray-500">
              {timesheet.employee?.full_name} ({timesheet.employee?.employee_number})
            </p>
          </div>
          <StatusBadge status={timesheet.status} />
        </div>

        {/* Shift Info */}
        <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
          <h2 className="font-semibold text-gray-900">Shift Details</h2>
          <div className="flex justify-between">
            <span className="text-gray-500">Date</span>
            <span className="font-medium">{formatDateTime(timesheet.actual_start)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Scheduled</span>
            <span className="font-medium">
              {formatTime(timesheet.scheduled_start)} – {formatTime(timesheet.scheduled_finish)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Actual</span>
            <span className="font-medium">
              {formatTime(timesheet.actual_start)} – {formatTime(timesheet.actual_finish)}
            </span>
          </div>
          {timesheet.shift_location && (
            <div className="flex justify-between">
              <span className="text-gray-500">Location</span>
              <span className="font-medium">{timesheet.shift_location}</span>
            </div>
          )}
        </div>

        {/* Hours & Distance */}
        <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
          <h2 className="font-semibold text-gray-900">Hours & Distance</h2>
          <div className="flex justify-between">
            <span className="text-gray-500">Hours Worked</span>
            <span className="font-medium">{formatDuration(timesheet.worked_minutes)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Start Odometer</span>
            <span className="font-medium">{timesheet.start_odometer.toLocaleString()} km</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Finish Odometer</span>
            <span className="font-medium">{timesheet.finish_odometer.toLocaleString()} km</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Distance</span>
            <span className="font-medium">{timesheet.distance_km} km</span>
          </div>
        </div>

        {/* Payment Breakdown */}
        <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
          <h2 className="font-semibold text-gray-900">Payment Breakdown</h2>
          <div className="flex justify-between">
            <span className="text-gray-500">Rate</span>
            <span className="font-medium">${timesheet.hourly_rate_snapshot.toFixed(2)}/hr</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Wages</span>
            <span className="font-medium">${timesheet.wage_amount.toFixed(2)}</span>
          </div>
          <hr className="my-1" />
          <div className="flex justify-between">
            <span className="text-gray-500">Mileage Rate</span>
            <span className="font-medium">${timesheet.mileage_rate_snapshot.toFixed(2)}/km</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Mileage</span>
            <span className="font-medium">${timesheet.mileage_amount.toFixed(2)}</span>
          </div>
          <hr className="my-1" />
          <div className="flex justify-between font-bold">
            <span>Estimated Total</span>
            <span className="text-green-600">${timesheet.estimated_total.toFixed(2)}</span>
          </div>
          {timesheet.approved_total !== null && (
            <div className="flex justify-between font-bold">
              <span>Approved Total</span>
              <span className="text-blue-600">${timesheet.approved_total.toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Action buttons — only for submitted timesheets */}
        {timesheet.status === "submitted" && (
          <div className="flex gap-3">
            <button
              onClick={() => handleAction("approve")}
              disabled={acting}
              className="flex-1 bg-green-600 text-white rounded-lg py-3 text-sm font-bold
                         hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {acting ? "…" : "✅ Approve"}
            </button>
            <button
              onClick={() => handleAction("needs_correction")}
              disabled={acting}
              className="flex-1 bg-orange-500 text-white rounded-lg py-3 text-sm font-bold
                         hover:bg-orange-600 disabled:opacity-50 transition-colors"
            >
              {acting ? "…" : "⚠️ Needs Correction"}
            </button>
          </div>
        )}

        {timesheet.status === "approved" && (
          <p className="text-center text-sm text-green-600 font-medium">
            ✅ This timesheet has been approved.
          </p>
        )}
        {timesheet.status === "needs_correction" && (
          <p className="text-center text-sm text-orange-600 font-medium">
            ⚠️ This timesheet needs correction.
          </p>
        )}
      </div>
    </div>
  );
}
