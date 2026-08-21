"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";

interface Shift {
  id: string;
  date: string;
  scheduled_start: string;
  scheduled_finish: string;
  location: string | null;
  status: string;
  event_id: string | null;
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
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function EmployeeShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [eventNames, setEventNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/shifts")
      .then((res) => res.json())
      .then(async (data) => {
        if (Array.isArray(data)) {
          setShifts(data);
          // Fetch event names for event-linked shifts
          const eventIds = [...new Set(data.filter((s: Shift) => s.event_id).map((s: Shift) => s.event_id))];
          if (eventIds.length > 0) {
            try {
              const eventsRes = await fetch("/api/events?upcoming=true");
              const events = await eventsRes.json();
              if (Array.isArray(events)) {
                const names: Record<string, string> = {};
                events.forEach((e: { id: string; name: string }) => { names[e.id] = e.name; });
                // Also fetch all events in case some are past
                const allRes = await fetch("/api/events");
                const allEvents = await allRes.json();
                if (Array.isArray(allEvents)) {
                  allEvents.forEach((e: { id: string; name: string }) => { names[e.id] = e.name; });
                }
                setEventNames(names);
              }
            } catch { /* ignore */ }
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading shifts…</div>;

  if (shifts.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
        <p className="text-gray-500">No shifts assigned to you yet.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Shifts</h1>
      <div className="space-y-3">
        {shifts.map((shift) => (
          <Link
            key={shift.id}
            href={`/employee/shifts/${shift.id}`}
            className={`block rounded-xl border p-4 transition-colors ${
              shift.event_id
                ? "bg-purple-50 border-purple-200 hover:border-purple-400"
                : "bg-white border-gray-200 hover:border-blue-300"
            }`}
          >
            {shift.event_id && eventNames[shift.event_id] && (
              <div className="text-[11px] font-medium text-purple-600 mb-1">
                ⚽ {eventNames[shift.event_id]}
              </div>
            )}
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-gray-900">{formatDate(shift.date)}</span>
              <StatusBadge status={shift.status} />
            </div>
            <div className="text-sm text-gray-500">
              <div>
                {formatTime(shift.scheduled_start)} – {formatTime(shift.scheduled_finish)}
              </div>
              {shift.location && <div>{shift.location}</div>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
