"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

function extractHHMM(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function EditEventPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Form state
  const [name, setName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [location, setLocation] = useState("");
  const [startTime, setStartTime] = useState("");
  const [finishTime, setFinishTime] = useState("");
  const [role, setRole] = useState("");
  const [requiredCount, setRequiredCount] = useState("");
  const [instructions, setInstructions] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    fetch(`/api/events/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          setLoading(false);
          return;
        }
        setName(data.name || "");
        setEventDate(data.event_date || "");
        setLocation(data.location || "");
        setStartTime(extractHHMM(data.start_time));
        setFinishTime(extractHHMM(data.finish_time));
        setDescription(data.description || "");

        const req = data.event_staffing_requirements?.[0];
        if (req) {
          setRole(req.role || "");
          setRequiredCount(String(req.required_count || ""));
          setInstructions(req.instructions || "");
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load event.");
        setLoading(false);
      });
  }, [id]);

  async function handleSave() {
    setError("");
    setSuccess("");

    if (!name || !eventDate || !startTime || !finishTime) {
      setError("Event name, date, start time, and finish time are required.");
      return;
    }
    if (startTime >= finishTime) {
      setError("Finish time must be after start time.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/events/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit",
          name,
          event_date: eventDate,
          location,
          startTime,
          finishTime,
          role: role || "General",
          required_count: parseInt(requiredCount) || 1,
          instructions,
          description,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to save.");
        setSaving(false);
        return;
      }

      setSuccess(data.message || "Event updated.");
      setTimeout(() => router.push(`/admin/events/${id}`), 1200);
    } catch {
      setError("Network error.");
    }
    setSaving(false);
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading event…</div>;
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href={`/admin/events/${id}`} className="text-gray-400 hover:text-gray-600 text-2xl">‹</Link>
        <h1 className="text-xl font-bold text-gray-900">Edit Event</h1>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Event Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. St Helens"
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Time *</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Finish Time *</label>
            <input
              type="time"
              value={finishTime}
              onChange={(e) => setFinishTime(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Delivery"
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Workers Needed</label>
            <input
              type="number"
              value={requiredCount}
              onChange={(e) => setRequiredCount(e.target.value)}
              min="1"
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Optional event description"
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Instructions for Workers</label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={2}
            placeholder="Optional instructions for assigned workers"
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 mt-4 text-sm">{error}</div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-xl p-3 mt-4 text-sm">✓ {success}</div>
      )}

      <div className="space-y-2 mt-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-blue-600 text-white rounded-xl py-3.5 text-sm font-semibold
                     hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
        <Link
          href={`/admin/events/${id}`}
          className="block w-full text-center border border-gray-300 text-gray-700 rounded-xl py-3 text-sm
                     font-medium hover:bg-gray-50 transition-colors"
        >
          Cancel
        </Link>
      </div>
    </div>
  );
}
