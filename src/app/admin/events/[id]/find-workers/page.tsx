"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

interface WorkerCandidate {
  id: string;
  full_name: string;
  employee_number: string;
  employment_type: string | null;
  open_to_extra_shifts: boolean;
  status: "available" | "partial" | "unavailable" | "conflict";
  reason?: string;
  availabilityWindow?: string;
  weeklyHours: number;
  existingShiftTime?: string;
  alreadyAssigned: boolean;
}

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

function employmentLabel(type: string | null): string {
  switch (type) {
    case "CASUAL": return "Casual";
    case "PART_TIME": return "Part-time";
    case "PERMANENT": return "Permanent";
    default: return "";
  }
}

function employmentBadgeColor(type: string | null): string {
  switch (type) {
    case "CASUAL": return "bg-purple-100 text-purple-700";
    case "PART_TIME": return "bg-blue-100 text-blue-700";
    case "PERMANENT": return "bg-green-100 text-green-700";
    default: return "bg-gray-100 text-gray-600";
  }
}

export default function FindWorkersPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [workers, setWorkers] = useState<WorkerCandidate[]>([]);
  const [event, setEvent] = useState<StaffingEvent | null>(null);
  const [requirement, setRequirement] = useState<StaffingRequirement | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/events/${id}/find-workers`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          setLoading(false);
          return;
        }
        setWorkers(data.workers || []);
        setEvent(data.event);
        setRequirement(data.requirement);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load workers");
        setLoading(false);
      });
  }, [id]);

  function toggleWorker(workerId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(workerId)) {
        next.delete(workerId);
      } else {
        next.add(workerId);
      }
      return next;
    });
  }

  async function handleAssign() {
    if (selected.size === 0) return;
    setAssigning(true);
    setError("");

    try {
      const res = await fetch(`/api/events/${id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeIds: Array.from(selected) }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Assignment failed.");
        setAssigning(false);
        return;
      }

      setResult({
        success: true,
        message: `${data.assigned} worker${data.assigned !== 1 ? "s" : ""} assigned! (${data.totalFilled}/${data.totalRequired} filled)`,
      });
    } catch {
      setError("Network error.");
    }
    setAssigning(false);
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Finding workers…</div>;
  }

  if (result?.success) {
    return (
      <div className="max-w-lg mx-auto text-center py-12">
        <div className="text-5xl mb-4">✅</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Workers Assigned</h2>
        <p className="text-gray-600 mb-6">{result.message}</p>
        <Link
          href={`/admin/events/${id}`}
          className="inline-block bg-blue-600 text-white rounded-xl px-6 py-3 text-sm font-semibold hover:bg-blue-700"
        >
          View Event
        </Link>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">{error || "Event not found."}</p>
        <Link href="/admin/events" className="text-blue-600 hover:underline text-sm">Back to Events</Link>
      </div>
    );
  }

  const remaining = requirement
    ? Math.max(0, requirement.required_count - (requirement.filled_count || 0))
    : 0;

  // Group workers
  const alreadyAssigned = workers.filter((w) => w.alreadyAssigned);
  const bestMatches = workers.filter((w) => !w.alreadyAssigned && w.status === "available");
  const partiallyAvailable = workers.filter((w) => !w.alreadyAssigned && w.status === "partial");
  const notAvailable = workers.filter(
    (w) => !w.alreadyAssigned && (w.status === "unavailable" || w.status === "conflict")
  );

  const selectableCount = selected.size;

  return (
    <div className="max-w-lg mx-auto pb-32">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href={`/admin/events/${id}`} className="text-gray-400 hover:text-gray-600 text-2xl">‹</Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-gray-900">
            Need {remaining} {requirement?.role || "Worker"}{remaining !== 1 ? "s" : ""}
          </h1>
          <p className="text-sm text-gray-500">
            {event.name} · {formatDate(event.event_date)}
          </p>
        </div>
      </div>

      {/* Event summary */}
      <div className="bg-gray-50 rounded-xl p-3 mb-5 text-sm text-gray-600">
        <span className="font-medium text-gray-900">{formatTime(event.start_time)} – {formatTime(event.finish_time)}</span>
        {event.location && <span> · 📍 {event.location}</span>}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Already assigned */}
      {alreadyAssigned.length > 0 && (
        <div className="mb-5">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Already Assigned ({alreadyAssigned.length})
          </h3>
          {alreadyAssigned.map((w) => (
            <div key={w.id} className="flex items-center gap-3 bg-green-50 rounded-xl p-3 mb-1.5">
              <span className="text-green-500 text-lg">✓</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 text-sm">{w.full_name}</div>
                <div className="text-xs text-gray-500">
                  {employmentLabel(w.employment_type)} · {w.weeklyHours}h this week
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Best Matches */}
      {bestMatches.length > 0 && (
        <div className="mb-5">
          <h3 className="text-xs font-semibold text-green-600 uppercase tracking-wider mb-2">
            🟢 Best Matches ({bestMatches.length})
          </h3>
          {bestMatches.map((w) => (
            <WorkerCard
              key={w.id}
              worker={w}
              isSelected={selected.has(w.id)}
              onToggle={() => toggleWorker(w.id)}
              disabled={!selected.has(w.id) && selectableCount >= remaining}
            />
          ))}
        </div>
      )}

      {/* Partially Available */}
      {partiallyAvailable.length > 0 && (
        <div className="mb-5">
          <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-2">
            🟡 Partially Available ({partiallyAvailable.length})
          </h3>
          {partiallyAvailable.map((w) => (
            <WorkerCard
              key={w.id}
              worker={w}
              isSelected={selected.has(w.id)}
              onToggle={() => toggleWorker(w.id)}
              disabled={!selected.has(w.id) && selectableCount >= remaining}
            />
          ))}
        </div>
      )}

      {/* Not Available */}
      {notAvailable.length > 0 && (
        <div className="mb-5">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Not Available ({notAvailable.length})
          </h3>
          {notAvailable.map((w) => (
            <div key={w.id} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3 mb-1.5 opacity-60">
              <div className="w-5 h-5 rounded border-2 border-gray-300 bg-gray-100 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-500 text-sm">{w.full_name}</div>
                <div className="text-xs text-gray-400">
                  {w.reason}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {workers.filter((w) => !w.alreadyAssigned).length === 0 && (
        <div className="text-center py-8 text-gray-400 text-sm">
          No employees found.
        </div>
      )}

      {/* Sticky assign bar */}
      {remaining > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 safe-bottom z-50">
          <div className="max-w-lg mx-auto">
            <div className="flex items-center justify-between mb-2 text-sm">
              <span className="text-gray-500">
                {selectableCount} / {remaining} selected
              </span>
              {selectableCount > 0 && (
                <button onClick={() => setSelected(new Set())} className="text-blue-600 text-xs">
                  Clear
                </button>
              )}
            </div>
            <button
              onClick={handleAssign}
              disabled={selectableCount === 0 || assigning}
              className="w-full bg-blue-600 text-white rounded-xl py-3.5 text-sm font-semibold
                         hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {assigning
                ? "Assigning…"
                : selectableCount > 0
                  ? `Assign ${selectableCount} Worker${selectableCount !== 1 ? "s" : ""}`
                  : "Select Workers to Assign"
              }
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkerCard({
  worker,
  isSelected,
  onToggle,
  disabled,
}: {
  worker: WorkerCandidate;
  isSelected: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      className={`w-full flex items-center gap-3 rounded-xl p-3 mb-1.5 text-left transition-colors
        ${isSelected
          ? "bg-blue-50 border-2 border-blue-400"
          : "bg-white border border-gray-200 hover:border-gray-300"
        }
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
      `}
    >
      {/* Checkbox */}
      <div
        className={`w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center transition-colors
          ${isSelected ? "bg-blue-600 border-blue-600" : "border-gray-300 bg-white"}
        `}
      >
        {isSelected && (
          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 16 16">
            <path d="M13.854 3.646a.5.5 0 010 .708l-7 7a.5.5 0 01-.708 0l-3.5-3.5a.5.5 0 11.708-.708L6.5 10.293l6.646-6.647a.5.5 0 01.708 0z" />
          </svg>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 text-sm">{worker.full_name}</span>
          {worker.employment_type && (
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${employmentBadgeColor(worker.employment_type)}`}>
              {employmentLabel(worker.employment_type)}
            </span>
          )}
          {worker.open_to_extra_shifts && (
            <span className="text-[10px] text-amber-600" title="Open to extra shifts">⭐</span>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">
          {worker.reason || "Available"} · {worker.weeklyHours}h this week
        </div>
      </div>
    </button>
  );
}
