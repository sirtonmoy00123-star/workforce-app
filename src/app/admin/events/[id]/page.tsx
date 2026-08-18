"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface StaffingRequirement {
  id: string;
  role: string;
  required_count: number;
  filled_count: number;
}

interface EventShift {
  id: string;
  employee_id: string;
  date: string;
  scheduled_start: string;
  scheduled_finish: string;
  status: string;
}

interface StaffingEvent {
  id: string;
  name: string;
  description: string | null;
  event_date: string;
  location: string | null;
  start_time: string;
  finish_time: string;
  status: string;
  event_staffing_requirements: StaffingRequirement[];
  eventShifts: EventShift[];
  employeeMap: Record<string, string>;
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

function statusColor(status: string): string {
  switch (status) {
    case "OPEN": return "bg-blue-100 text-blue-700";
    case "PARTIALLY_FILLED": return "bg-amber-100 text-amber-700";
    case "FULLY_STAFFED": return "bg-green-100 text-green-700";
    case "CANCELLED": return "bg-red-100 text-red-700";
    case "COMPLETED": return "bg-gray-100 text-gray-700";
    default: return "bg-gray-100 text-gray-700";
  }
}

function shiftStatusColor(status: string): string {
  switch (status) {
    case "accepted": return "text-green-600";
    case "pending": return "text-amber-600";
    case "updated_pending": return "text-amber-700";
    case "declined": return "text-red-600";
    case "completed": return "text-green-600";
    case "cancelled": return "text-gray-500";
    default: return "text-gray-500";
  }
}

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<StaffingEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  useEffect(() => {
    fetch(`/api/events/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setLoading(false);
          return;
        }
        setEvent(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/events/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (res.ok) {
        router.push("/admin/roster");
      }
    } catch { /* ignore */ }
    setCancelling(false);
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading event…</div>;
  }

  if (!event) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">Event not found.</p>
        <Link href="/admin/roster" className="text-blue-600 hover:underline text-sm">Back to Roster</Link>
      </div>
    );
  }

  const req = event.event_staffing_requirements[0];
  const totalRequired = req?.required_count || 0;
  const totalFilled = req?.filled_count || 0;
  const remaining = Math.max(0, totalRequired - totalFilled);
  const isCancelled = event.status === "CANCELLED";
  const isCompleted = event.status === "COMPLETED";
  const isActive = !isCancelled && !isCompleted;

  // Accepted/assigned shifts
  const assignedShifts = event.eventShifts?.filter(
    (s) => !["cancelled", "declined"].includes(s.status)
  ) || [];

  return (
    <div className="max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/roster" className="text-gray-400 hover:text-gray-600 text-2xl">‹</Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{event.name}</h1>
          <span className={`inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full ${statusColor(event.status)}`}>
            {event.status.replace(/_/g, " ")}
          </span>
        </div>
      </div>

      {/* Event Info */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
        <div className="space-y-2 text-sm">
          <div className="text-gray-900 font-medium">{formatDate(event.event_date)}</div>
          <div className="text-lg font-semibold text-gray-900">
            {formatTime(event.start_time)} – {formatTime(event.finish_time)}
          </div>
          {event.location && (
            <div className="text-gray-600">📍 {event.location}</div>
          )}
          {req && (
            <div className="text-gray-600">
              🏷️ {req.role} · {totalRequired} worker{totalRequired !== 1 ? "s" : ""} needed
            </div>
          )}
          {event.description && (
            <div className="text-gray-500 text-xs bg-gray-50 rounded-lg p-2 mt-2">
              📝 {event.description}
            </div>
          )}
        </div>
      </div>

      {/* Staffing Progress */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Staffing</h2>

        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-2xl font-bold text-gray-900">{totalFilled}</span>
            <span className="text-gray-500"> / {totalRequired}</span>
          </div>
          {totalFilled >= totalRequired ? (
            <span className="text-sm font-medium text-green-600">✓ Fully Staffed</span>
          ) : (
            <span className="text-sm font-medium text-amber-600">
              ⚠ Need {remaining} more
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
          <div
            className={`h-2 rounded-full transition-all ${
              totalFilled >= totalRequired ? "bg-green-500" : "bg-amber-500"
            }`}
            style={{ width: `${Math.min(100, (totalFilled / totalRequired) * 100)}%` }}
          />
        </div>

        {/* Assigned workers */}
        {assignedShifts.length > 0 && (
          <div className="space-y-1.5 mb-4">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Assigned</div>
            {assignedShifts.map((s) => (
              <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded-lg p-2.5 text-sm">
                <span className="font-medium text-gray-900">
                  {event.employeeMap[s.employee_id] || "Unknown"}
                </span>
                <span className={`text-xs font-medium capitalize ${shiftStatusColor(s.status)}`}>
                  {s.status.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        {isActive && remaining > 0 && (
          <div className="space-y-2">
            <Link
              href={`/admin/events/${event.id}`}
              className="block w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold
                         hover:bg-blue-700 transition-colors text-center"
            >
              🔍 Find {remaining} More Worker{remaining !== 1 ? "s" : ""}
            </Link>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {isActive && (
        <div className="space-y-2 mb-4">
          <Link
            href={`/admin/events/new?date=${event.event_date}&startTime=${new Date(event.start_time).toTimeString().slice(0,5)}&finishTime=${new Date(event.finish_time).toTimeString().slice(0,5)}&location=${event.location || ""}`}
            className="block w-full border border-gray-300 text-gray-700 rounded-xl py-3 text-sm
                       font-medium hover:bg-gray-50 transition-colors text-center"
          >
            ✏️ Edit Event
          </Link>

          {!showCancelConfirm ? (
            <button
              onClick={() => setShowCancelConfirm(true)}
              className="w-full border border-red-200 text-red-600 rounded-xl py-3 text-sm
                         font-medium hover:bg-red-50 transition-colors"
            >
              Cancel Event
            </button>
          ) : (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <p className="text-sm text-red-700 mb-3">
                Cancel this event? {assignedShifts.length > 0 && `${assignedShifts.length} assigned shift(s) will also be cancelled.`}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2 text-sm font-medium"
                >
                  Keep Event
                </button>
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="flex-1 bg-red-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
                >
                  {cancelling ? "Cancelling…" : "Yes, Cancel"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Back */}
      <Link
        href="/admin/roster"
        className="block w-full border border-gray-300 text-gray-700 rounded-xl py-3 text-sm
                   font-medium hover:bg-gray-50 transition-colors text-center"
      >
        Back to Roster
      </Link>
    </div>
  );
}
