"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";

interface Shift {
  id: string;
  date: string;
  scheduled_start: string;
  scheduled_finish: string;
  location: string | null;
  instructions: string | null;
  status: string;
  employee?: {
    full_name: string;
    employee_number: string;
  };
  attendance?: {
    attendance_status: string;
    actual_start: string | null;
    actual_finish: string | null;
  } | null;
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
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function ShiftDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [shift, setShift] = useState<Shift | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [justStarted, setJustStarted] = useState(false);

  useEffect(() => {
    // Check if we just came from starting the shift
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get("started") === "true") {
      setJustStarted(true);
    }

    fetch(`/api/shifts/${id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setShift(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load shift.");
        setLoading(false);
      });
  }, [id]);

  async function handleAction(action: "accept" | "decline" | "accept_updated") {
    setActing(true);
    setError("");
    try {
      const res = await fetch(`/api/shifts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Action failed.");
      } else {
        setShift((prev) => (prev ? { ...prev, status: data.status } : prev));
      }
    } catch {
      setError("Something went wrong.");
    }
    setActing(false);
  }

  const isWorking = shift?.attendance?.attendance_status === "working";

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;
  if (!shift) return <div className="text-center py-12 text-red-500">{error || "Shift not found."}</div>;

  return (
    <div className="max-w-lg mx-auto">
      <button
        onClick={() => router.push("/employee/shifts")}
        className="text-sm text-blue-600 hover:underline mb-4 inline-block"
      >
        ← Back to Shifts
      </button>

      {justStarted && (
        <div className="bg-green-50 text-green-700 text-sm rounded-lg p-3 border border-green-200 mb-4">
          ✅ Shift started! Your clock is now running.
        </div>
      )}

      {error && (
        <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold text-gray-900">Shift Details</h1>
          <StatusBadge status={isWorking ? "working" : shift.status} />
        </div>

        <div className="space-y-3 text-sm">
          <div>
            <span className="text-gray-500">Date</span>
            <div className="font-medium">{formatDate(shift.date)}</div>
          </div>
          <div>
            <span className="text-gray-500">Time</span>
            <div className="font-medium">
              {formatTime(shift.scheduled_start)} – {formatTime(shift.scheduled_finish)}
            </div>
          </div>
          {shift.location && (
            <div>
              <span className="text-gray-500">Location</span>
              <div className="font-medium">{shift.location}</div>
            </div>
          )}
          {shift.instructions && (
            <div>
              <span className="text-gray-500">Instructions</span>
              <div className="font-medium">{shift.instructions}</div>
            </div>
          )}
          {isWorking && shift.attendance?.actual_start && (
            <div>
              <span className="text-gray-500">Started at</span>
              <div className="font-medium">
                {new Date(shift.attendance.actual_start).toLocaleTimeString("en-AU", {
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                })}
              </div>
            </div>
          )}
        </div>

        {/* Accept / Decline buttons — only for pending shifts */}
        {shift.status === "pending" && (
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => handleAction("accept")}
              disabled={acting}
              className="flex-1 bg-green-600 text-white rounded-lg py-2.5 text-sm font-medium
                         hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {acting ? "…" : "Accept"}
            </button>
            <button
              onClick={() => handleAction("decline")}
              disabled={acting}
              className="flex-1 bg-red-600 text-white rounded-lg py-2.5 text-sm font-medium
                         hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {acting ? "…" : "Decline"}
            </button>
          </div>
        )}

        {/* Updated shift — requires reconfirmation */}
        {shift.status === "updated_pending" && (
          <div className="mt-6">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-amber-600 text-lg">⚠️</span>
                <span className="font-bold text-amber-800">Shift Changed</span>
              </div>
              <p className="text-sm text-amber-700">
                Your admin has updated this shift. Please review the new details above and confirm.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => handleAction("accept_updated")}
                disabled={acting}
                className="flex-1 bg-green-600 text-white rounded-lg py-2.5 text-sm font-medium
                           hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {acting ? "…" : "Accept Updated Shift"}
              </button>
              <button
                onClick={() => handleAction("decline")}
                disabled={acting}
                className="flex-1 bg-red-600 text-white rounded-lg py-2.5 text-sm font-medium
                           hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {acting ? "…" : "Decline"}
              </button>
            </div>
          </div>
        )}

        {/* Start Shift button — only for accepted shifts that haven't been started */}
        {shift.status === "accepted" && !isWorking && (
          <button
            onClick={() => router.push(`/employee/start-shift/${shift.id}`)}
            className="w-full mt-6 bg-blue-600 text-white rounded-lg py-3 text-base font-bold
                       hover:bg-blue-700 transition-colors"
          >
            START SHIFT
          </button>
        )}

        {/* Finish Shift button — only when actively working */}
        {isWorking && (
          <button
            onClick={() => router.push(`/employee/finish-shift/${shift.id}`)}
            className="w-full mt-6 bg-red-600 text-white rounded-lg py-3 text-base font-bold
                       hover:bg-red-700 transition-colors animate-pulse"
          >
            🏁 FINISH SHIFT
          </button>
        )}

        {/* Status messages */}
        {shift.status === "declined" && (
          <p className="mt-6 text-center text-sm text-gray-500">
            You declined this shift.
          </p>
        )}
        {shift.status === "completed" && (
          <p className="mt-6 text-center text-sm text-green-600 font-medium">
            This shift has been completed.
          </p>
        )}
      </div>
    </div>
  );
}
