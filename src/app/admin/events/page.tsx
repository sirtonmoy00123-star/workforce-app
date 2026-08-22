"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface StaffingRequirement {
  id: string;
  role: string;
  required_count: number;
  filled_count: number;
}

interface StaffingEvent {
  id: string;
  name: string;
  event_date: string;
  location: string | null;
  start_time: string;
  finish_time: string;
  status: string;
  event_staffing_requirements: StaffingRequirement[];
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
  });
}

function statusBadge(status: string): { bg: string; label: string } {
  switch (status) {
    case "OPEN": return { bg: "bg-blue-100 text-blue-700", label: "Open" };
    case "PARTIALLY_FILLED": return { bg: "bg-amber-100 text-amber-700", label: "Partially Filled" };
    case "FULLY_STAFFED": return { bg: "bg-green-100 text-green-700", label: "Fully Staffed" };
    case "CANCELLED": return { bg: "bg-red-100 text-red-700", label: "Cancelled" };
    case "COMPLETED": return { bg: "bg-gray-100 text-gray-600", label: "Completed" };
    case "DRAFT": return { bg: "bg-gray-100 text-gray-600", label: "Draft" };
    default: return { bg: "bg-gray-100 text-gray-600", label: status };
  }
}

export default function EventsListPage() {
  const [events, setEvents] = useState<StaffingEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"upcoming" | "all">("upcoming");

  useEffect(() => {
    setLoading(true);
    const params = filter === "upcoming" ? "?upcoming=true" : "";
    fetch(`/api/events${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setEvents(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [filter]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Event Staffing</h1>
          <p className="text-sm text-gray-500">Manage staffing for special events</p>
        </div>
        <Link
          href="/admin/events/new"
          className="bg-blue-600 text-white px-4 py-2.5 rounded-xl text-sm font-medium
                     hover:bg-blue-700 transition-colors"
        >
          + New Event
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setFilter("upcoming")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            filter === "upcoming" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
          }`}
        >
          Upcoming
        </button>
        <button
          onClick={() => setFilter("all")}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            filter === "all" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
          }`}
        >
          All
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading events…</div>
      ) : events.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="text-4xl mb-3">📅</div>
          <p className="text-gray-600 font-medium mb-1">No events {filter === "upcoming" ? "upcoming" : "found"}</p>
          <p className="text-gray-400 text-sm mb-4">Create an event when you need extra workers for a busy period</p>
          <Link
            href="/admin/events/new"
            className="inline-block px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium
                       hover:bg-blue-700 transition-colors"
          >
            + Create Event
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => {
            const req = event.event_staffing_requirements[0];
            const totalRequired = req?.required_count || 0;
            const totalFilled = req?.filled_count || 0;
            const badge = statusBadge(event.status);

            return (
              <Link
                key={event.id}
                href={`/admin/events/${event.id}`}
                className="block bg-white rounded-xl border border-gray-200 p-4
                           hover:border-blue-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-semibold text-gray-900">{event.name}</div>
                    <div className="text-sm text-gray-600 mt-0.5">
                      {formatDate(event.event_date)} · {formatTime(event.start_time)} – {formatTime(event.finish_time)}
                    </div>
                    {event.location && (
                      <div className="text-xs text-gray-500 mt-0.5">📍 {event.location}</div>
                    )}
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.bg}`}>
                    {badge.label}
                  </span>
                </div>

                {req && event.status !== "CANCELLED" && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${
                          totalFilled >= totalRequired ? "bg-green-500" : "bg-amber-500"
                        }`}
                        style={{ width: `${Math.min(100, (totalFilled / Math.max(1, totalRequired)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      {totalFilled} / {totalRequired}
                      {totalFilled >= totalRequired ? " ✓" : ""}
                    </span>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}

      {/* Back to roster */}
      <div className="mt-6">
        <Link href="/admin/roster" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to Roster
        </Link>
      </div>
    </div>
  );
}
