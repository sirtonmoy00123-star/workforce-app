"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function formatHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

export default function NewEventPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Pre-fill from query params (e.g. from "Fill Gap" button)
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [eventDate, setEventDate] = useState(searchParams.get("date") || "");
  const [startTime, setStartTime] = useState(searchParams.get("startTime") || "");
  const [finishTime, setFinishTime] = useState(searchParams.get("finishTime") || "");
  const [location, setLocation] = useState(searchParams.get("location") || "");
  const [role, setRole] = useState("General");
  const [requiredCount, setRequiredCount] = useState(searchParams.get("count") || "4");
  const [instructions, setInstructions] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ eventId: string; name: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          event_date: eventDate,
          location,
          startTime,
          finishTime,
          role,
          required_count: parseInt(requiredCount, 10),
          instructions,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create event.");
        setLoading(false);
        return;
      }

      setSuccess({ eventId: data.event.id, name: data.event.name });
      setLoading(false);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  // ── Success screen ──
  if (success) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Event Created!</h1>
          <p className="text-gray-600 mb-6">{success.name}</p>

          <div className="bg-gray-50 rounded-xl p-4 mb-6 text-sm text-left space-y-1">
            <div className="text-gray-600">
              <span className="font-medium">Date:</span>{" "}
              {new Date(eventDate + "T00:00:00").toLocaleDateString("en-AU", {
                weekday: "long", day: "numeric", month: "long", year: "numeric"
              })}
            </div>
            <div className="text-gray-600">
              <span className="font-medium">Time:</span> {formatHHMM(startTime)} – {formatHHMM(finishTime)}
            </div>
            {location && (
              <div className="text-gray-600">
                <span className="font-medium">Location:</span> {location}
              </div>
            )}
            <div className="text-gray-600">
              <span className="font-medium">Role:</span> {role}
            </div>
            <div className="text-gray-600">
              <span className="font-medium">Workers needed:</span> {requiredCount}
            </div>
          </div>

          <div className="space-y-2">
            <Link
              href={`/admin/events/${success.eventId}`}
              className="block w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold
                         hover:bg-blue-700 transition-colors text-center"
            >
              Find Workers →
            </Link>
            <Link
              href="/admin/roster"
              className="block w-full border border-gray-300 text-gray-700 rounded-xl py-3 text-sm
                         font-medium hover:bg-gray-50 transition-colors text-center"
            >
              Back to Roster
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Create form ──
  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/roster" className="text-gray-400 hover:text-gray-600 text-2xl">‹</Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Event Staffing</h1>
          <p className="text-sm text-gray-500">Create a staffing event for busy periods</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 p-5 space-y-5">
        {/* Event Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Event Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Footy Night, Concert, Large Delivery"
            required
            className="w-full rounded-xl border border-gray-300 px-3 py-3 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Date */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            required
            className="w-full rounded-xl border border-gray-300 px-3 py-3 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Location */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. St Helens"
            className="w-full rounded-xl border border-gray-300 px-3 py-3 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Time */}
        <div>
          <div className="text-sm font-medium text-gray-700 mb-1">Busy Time *</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Start</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="w-full rounded-xl border border-gray-300 px-3 py-3 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Finish</label>
              <input
                type="time"
                value={finishTime}
                onChange={(e) => setFinishTime(e.target.value)}
                required
                className="w-full rounded-xl border border-gray-300 px-3 py-3 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Role */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Delivery, Kitchen, General"
            className="w-full rounded-xl border border-gray-300 px-3 py-3 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Extra Workers Needed */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Extra Workers Needed *</label>
          <input
            type="number"
            min="1"
            max="100"
            value={requiredCount}
            onChange={(e) => setRequiredCount(e.target.value)}
            required
            className="w-full rounded-xl border border-gray-300 px-3 py-3 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Description / Instructions (optional) */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes / Instructions</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Any special instructions for workers…"
            className="w-full rounded-xl border border-gray-300 px-3 py-3 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200">
            {error}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white rounded-xl py-3.5 text-sm font-semibold
                     hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? "Creating…" : "Find Workers"}
        </button>
      </form>
    </div>
  );
}
