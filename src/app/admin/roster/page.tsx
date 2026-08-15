"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";

interface Shift {
  id: string;
  employee_id: string;
  date: string;
  scheduled_start: string;
  scheduled_finish: string;
  location: string | null;
  instructions: string | null;
  status: string;
  recurring_group_id: string | null;
}

interface Employee {
  id: string;
  full_name: string;
  employee_number: string;
}

interface ValidationIssue {
  type: string;
  message: string;
  details?: string;
}

interface PreviewResult {
  validation: {
    valid: boolean;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
  };
  needsReconfirmation: boolean;
  isRecurring: boolean;
  original: {
    date: string;
    scheduled_start: string;
    scheduled_finish: string;
    location: string | null;
    instructions: string | null;
    status: string;
  };
  employee: { full_name: string };
}

// Change reason presets
const CHANGE_REASONS = [
  "Business requirement changed",
  "Employee requested different time",
  "Staffing adjustment",
  "Site operating hours changed",
  "Other",
];

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatTimeShort(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
}

function extractTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "pm" : "am";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatFullDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function RosterPage() {
  const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()));
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [modalMode, setModalMode] = useState<"view" | "edit" | "review" | "saving">("view");

  // Edit form state
  const [editDate, setEditDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editInstructions, setEditInstructions] = useState("");

  // Review state
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [changeNotes, setChangeNotes] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");
  const [saveError, setSaveError] = useState("");

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  useEffect(() => {
    setLoading(true);
    const startDate = formatDate(weekDates[0]);
    const endDate = formatDate(weekDates[6]);

    Promise.all([
      fetch(`/api/shifts?startDate=${startDate}&endDate=${endDate}`).then((r) => r.json()),
      fetch("/api/employees").then((r) => r.json()),
    ]).then(([shiftsData, employeesData]) => {
      if (Array.isArray(shiftsData)) setShifts(shiftsData);
      if (Array.isArray(employeesData)) setEmployees(employeesData);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  function prevWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() - 7);
    setWeekStart(d);
  }

  function nextWeek() {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 7);
    setWeekStart(d);
  }

  function thisWeek() {
    setWeekStart(getMonday(new Date()));
  }

  // ── Modal handlers ──

  function openShiftModal(shift: Shift) {
    setSelectedShift(shift);
    setModalMode("view");
    setReviewError("");
    setSaveSuccess("");
    setSaveError("");
    setPreview(null);
    setChangeReason("");
    setChangeNotes("");
    setOverrideReason("");
  }

  function closeModal() {
    setSelectedShift(null);
    setModalMode("view");
  }

  function startEditing() {
    if (!selectedShift) return;

    // Check if shift can be edited
    if (selectedShift.status === "completed") {
      setReviewError("This shift has been completed. Use Timesheet Correction to change actual working records.");
      return;
    }

    setEditDate(selectedShift.date);
    setEditStartTime(extractTime(selectedShift.scheduled_start));
    setEditEndTime(extractTime(selectedShift.scheduled_finish));
    setEditLocation(selectedShift.location || "");
    setEditInstructions(selectedShift.instructions || "");
    setModalMode("edit");
    setReviewError("");
    setSaveSuccess("");
    setSaveError("");
  }

  async function handleReviewUpdate() {
    if (!selectedShift) return;
    setReviewError("");
    setPreview(null);

    try {
      const res = await fetch(`/api/shifts/${selectedShift.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview_edit",
          date: editDate,
          startTime: editStartTime,
          endTime: editEndTime,
          location: editLocation,
          instructions: editInstructions,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.validation) {
          setPreview(data);
          setModalMode("review");
        } else {
          setReviewError(data.error || "Validation failed.");
        }
        return;
      }

      setPreview(data);
      setModalMode("review");
    } catch {
      setReviewError("Something went wrong. Please try again.");
    }
  }

  async function handleSaveUpdate() {
    if (!selectedShift || !preview) return;
    setSaveError("");
    setModalMode("saving");

    // Require change reason
    if (!changeReason) {
      setSaveError("Please select a reason for this change.");
      setModalMode("review");
      return;
    }

    // Require override reason if warnings exist
    if (preview.validation.warnings.length > 0 && !overrideReason) {
      setSaveError("Please provide an override reason for the warnings.");
      setModalMode("review");
      return;
    }

    try {
      const res = await fetch(`/api/shifts/${selectedShift.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_shift",
          date: editDate,
          startTime: editStartTime,
          endTime: editEndTime,
          location: editLocation,
          instructions: editInstructions,
          changeReason: changeReason === "Other" ? changeNotes || "Other" : changeReason,
          changeNotes,
          overrideReason: overrideReason || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSaveError(data.error || "Failed to update shift.");
        setModalMode("review");
        return;
      }

      // Success — update local state
      setShifts((prev) =>
        prev.map((s) =>
          s.id === selectedShift.id
            ? {
                ...s,
                date: editDate,
                scheduled_start: new Date(`${editDate}T${editStartTime}:00`).toISOString(),
                scheduled_finish: new Date(`${editDate}T${editEndTime}:00`).toISOString(),
                location: editLocation || null,
                instructions: editInstructions || null,
                status: data.status,
              }
            : s
        )
      );

      setSaveSuccess(data.message || "Shift updated successfully.");
      setModalMode("view");
      // Update selectedShift to reflect changes
      setSelectedShift((prev) =>
        prev
          ? {
              ...prev,
              date: editDate,
              scheduled_start: new Date(`${editDate}T${editStartTime}:00`).toISOString(),
              scheduled_finish: new Date(`${editDate}T${editEndTime}:00`).toISOString(),
              location: editLocation || null,
              instructions: editInstructions || null,
              status: data.status,
            }
          : null
      );
    } catch {
      setSaveError("Something went wrong. Please try again.");
      setModalMode("review");
    }
  }

  // Build a lookup: employeeId -> { dateStr -> Shift[] }
  const shiftMap: Record<string, Record<string, Shift[]>> = {};
  shifts.forEach((s) => {
    if (!shiftMap[s.employee_id]) shiftMap[s.employee_id] = {};
    const dateStr = s.date;
    if (!shiftMap[s.employee_id][dateStr]) shiftMap[s.employee_id][dateStr] = [];
    shiftMap[s.employee_id][dateStr].push(s);
  });

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Weekly Roster</h1>
        <Link
          href="/admin/shifts/new"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium
                     hover:bg-blue-700 transition-colors text-center"
        >
          + Create Shift
        </Link>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 p-3 mb-4">
        <button
          onClick={prevWeek}
          className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          ← Prev
        </button>
        <div className="text-center">
          <button
            onClick={thisWeek}
            className="text-sm font-medium text-gray-900 hover:text-blue-600"
          >
            {weekDates[0].toLocaleDateString("en-AU", { month: "short", day: "numeric" })}
            {" – "}
            {weekDates[6].toLocaleDateString("en-AU", { month: "short", day: "numeric", year: "numeric" })}
          </button>
        </div>
        <button
          onClick={nextWeek}
          className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          Next →
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading roster…</div>
      ) : employees.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500">No employees yet.</p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-3 font-medium text-gray-600 w-36">Employee</th>
                    {weekDates.map((d, i) => (
                      <th key={i} className="text-center px-2 py-3 font-medium text-gray-600">
                        <div>{DAY_LABELS[i]}</div>
                        <div className="text-xs text-gray-400 font-normal">
                          {d.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {employees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 font-medium text-gray-900">{emp.full_name}</td>
                      {weekDates.map((d, i) => {
                        const dateStr = formatDate(d);
                        const dayShifts = shiftMap[emp.id]?.[dateStr] || [];
                        return (
                          <td key={i} className="px-2 py-2 text-center">
                            {dayShifts.length === 0 ? (
                              <span className="text-gray-300 text-xs">OFF</span>
                            ) : (
                              dayShifts.map((s) => (
                                <button
                                  key={s.id}
                                  onClick={() => openShiftModal(s)}
                                  className="mb-1 w-full text-left p-1.5 rounded-lg border border-transparent
                                             hover:border-blue-300 hover:bg-blue-50 transition-colors cursor-pointer"
                                >
                                  <div className="text-xs font-medium">
                                    {formatTime(s.scheduled_start)}–{formatTime(s.scheduled_finish)}
                                  </div>
                                  {s.location && (
                                    <div className="text-[10px] text-gray-500 truncate">{s.location}</div>
                                  )}
                                  <StatusBadge status={s.status} />
                                </button>
                              ))
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-4">
            {weekDates.map((d, i) => {
              const dateStr = formatDate(d);
              const dayShifts = shifts.filter((s) => s.date === dateStr);
              return (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-4">
                  <h3 className="font-medium text-gray-900 mb-2">
                    {DAY_LABELS[i]}{" "}
                    {d.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                  </h3>
                  {dayShifts.length === 0 ? (
                    <p className="text-sm text-gray-400">No shifts</p>
                  ) : (
                    <div className="space-y-2">
                      {dayShifts.map((s) => {
                        const emp = employees.find((e) => e.id === s.employee_id);
                        return (
                          <button
                            key={s.id}
                            onClick={() => openShiftModal(s)}
                            className="w-full text-left flex items-center justify-between text-sm
                                       border-l-2 border-blue-400 pl-3 py-1 hover:bg-blue-50
                                       rounded-r-lg transition-colors"
                          >
                            <div>
                              <div className="font-medium">{emp?.full_name}</div>
                              <div className="text-gray-500">
                                {formatTime(s.scheduled_start)}–{formatTime(s.scheduled_finish)}
                                {s.location && ` · ${s.location}`}
                              </div>
                            </div>
                            <StatusBadge status={s.status} />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Shift Modal ── */}
      {selectedShift && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="p-6">
              {/* Close button */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">
                  {modalMode === "view" && "Shift Details"}
                  {modalMode === "edit" && "Edit Shift"}
                  {(modalMode === "review" || modalMode === "saving") && "Review Update"}
                </h2>
                <button
                  onClick={closeModal}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              {/* Success message */}
              {saveSuccess && (
                <div className="bg-green-50 text-green-700 text-sm rounded-lg p-3 border border-green-200 mb-4">
                  {saveSuccess}
                </div>
              )}

              {/* Error messages */}
              {reviewError && (
                <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">
                  {reviewError}
                </div>
              )}

              {/* ── VIEW MODE ── */}
              {modalMode === "view" && (
                <>
                  <div className="space-y-3 text-sm mb-6">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Employee</span>
                      <span className="font-medium">
                        {employees.find((e) => e.id === selectedShift.employee_id)?.full_name}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Date</span>
                      <span className="font-medium">{formatFullDate(selectedShift.date)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Time</span>
                      <span className="font-medium">
                        {formatTimeShort(selectedShift.scheduled_start)} – {formatTimeShort(selectedShift.scheduled_finish)}
                      </span>
                    </div>
                    {selectedShift.location && (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500">Location</span>
                        <span className="font-medium">{selectedShift.location}</span>
                      </div>
                    )}
                    {selectedShift.instructions && (
                      <div>
                        <span className="text-gray-500">Instructions</span>
                        <div className="font-medium mt-0.5">{selectedShift.instructions}</div>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500">Status</span>
                      <StatusBadge status={selectedShift.status} />
                    </div>
                    {selectedShift.recurring_group_id && (
                      <div className="text-xs text-purple-600 bg-purple-50 rounded-lg p-2">
                        🔁 This shift belongs to a recurring series.
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="space-y-2">
                    {selectedShift.status !== "completed" && selectedShift.status !== "cancelled" && (
                      <button
                        onClick={startEditing}
                        className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium
                                   hover:bg-blue-700 transition-colors"
                      >
                        ✏️ Edit Shift
                      </button>
                    )}
                    <button
                      onClick={closeModal}
                      className="w-full border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm
                                 font-medium hover:bg-gray-50 transition-colors"
                    >
                      Close
                    </button>
                  </div>
                </>
              )}

              {/* ── EDIT MODE ── */}
              {modalMode === "edit" && (
                <>
                  <div className="text-sm text-gray-500 mb-4">
                    {employees.find((e) => e.id === selectedShift.employee_id)?.full_name}
                  </div>

                  {selectedShift.recurring_group_id && (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-4">
                      <p className="text-sm text-purple-800 font-medium mb-1">
                        This shift belongs to a recurring series.
                      </p>
                      <div className="flex items-center gap-2 text-sm">
                        <input type="radio" checked readOnly className="text-blue-600" />
                        <span className="text-purple-700">This shift only</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm mt-1 opacity-50">
                        <input type="radio" disabled className="text-gray-400" />
                        <span className="text-gray-500">This and future shifts (coming soon)</span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                      <input
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                        <input
                          type="time"
                          value={editStartTime}
                          onChange={(e) => setEditStartTime(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                                     focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Finish Time</label>
                        <input
                          type="time"
                          value={editEndTime}
                          onChange={(e) => setEditEndTime(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                                     focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                      <input
                        type="text"
                        value={editLocation}
                        onChange={(e) => setEditLocation(e.target.value)}
                        placeholder="e.g. Campbelltown"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Instructions</label>
                      <textarea
                        value={editInstructions}
                        onChange={(e) => setEditInstructions(e.target.value)}
                        rows={2}
                        placeholder="e.g. Cleaning shift"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={() => {
                        setModalMode("view");
                        setReviewError("");
                      }}
                      className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm
                                 font-medium hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleReviewUpdate}
                      className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium
                                 hover:bg-blue-700 transition-colors"
                    >
                      Review Update
                    </button>
                  </div>
                </>
              )}

              {/* ── REVIEW MODE ── */}
              {(modalMode === "review" || modalMode === "saving") && preview && (
                <>
                  {/* Change summary */}
                  <div className="bg-gray-50 rounded-lg p-4 mb-4 text-sm">
                    <div className="font-medium text-gray-900 mb-2">
                      {preview.employee?.full_name || employees.find((e) => e.id === selectedShift.employee_id)?.full_name}
                    </div>
                    <div className="space-y-1 text-gray-600">
                      <div className="flex justify-between">
                        <span>Date</span>
                        <span className="font-medium">
                          {preview.original.date !== editDate ? (
                            <>
                              <span className="line-through text-red-500 mr-1">
                                {formatFullDate(preview.original.date)}
                              </span>
                              → {formatFullDate(editDate)}
                            </>
                          ) : (
                            formatFullDate(editDate)
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Previous</span>
                        <span className="font-medium">
                          {formatTimeShort(preview.original.scheduled_start)} – {formatTimeShort(preview.original.scheduled_finish)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>New</span>
                        <span className="font-medium text-blue-600">
                          {formatHHMM(editStartTime)} – {formatHHMM(editEndTime)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Validation results */}
                  <div className="space-y-2 mb-4">
                    {/* Errors (blocking) */}
                    {preview.validation.errors.map((err, i) => (
                      <div key={`err-${i}`} className="bg-red-50 border border-red-200 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <span className="text-red-500 text-lg leading-none">✕</span>
                          <div>
                            <div className="text-sm font-medium text-red-800">{err.message}</div>
                            {err.details && (
                              <div className="text-xs text-red-600 mt-0.5">{err.details}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Warnings (overridable) */}
                    {preview.validation.warnings.map((warn, i) => (
                      <div key={`warn-${i}`} className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <div className="flex items-start gap-2">
                          <span className="text-amber-500 text-lg leading-none">⚠</span>
                          <div>
                            <div className="text-sm font-medium text-amber-800">{warn.message}</div>
                            {warn.details && (
                              <div className="text-xs text-amber-600 mt-0.5">{warn.details}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* All clear */}
                    {preview.validation.errors.length === 0 && preview.validation.warnings.length === 0 && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm text-green-700">
                          <span>✓</span> Employee active
                        </div>
                        <div className="flex items-center gap-2 text-sm text-green-700">
                          <span>✓</span> No shift overlap
                        </div>
                        <div className="flex items-center gap-2 text-sm text-green-700">
                          <span>✓</span> Availability valid
                        </div>
                      </div>
                    )}

                    {/* Reconfirmation notice */}
                    {preview.needsReconfirmation && (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <div className="text-sm text-blue-800">
                          <span className="font-medium">Employee reconfirmation required.</span>
                          <div className="text-xs mt-0.5">
                            The shift was previously accepted. This change will set the status to
                            &quot;Updated — Awaiting Confirmation&quot; and the employee will need to accept again.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Override reason (if warnings) */}
                  {preview.validation.warnings.length > 0 && preview.validation.errors.length === 0 && (
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Override Reason <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        value={overrideReason}
                        onChange={(e) => setOverrideReason(e.target.value)}
                        rows={2}
                        placeholder="e.g. John confirmed directly that he can work until 10 PM."
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  )}

                  {/* Change reason (always required) */}
                  {preview.validation.errors.length === 0 && (
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Reason for Change <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={changeReason}
                        onChange={(e) => setChangeReason(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
                      >
                        <option value="">Select a reason…</option>
                        {CHANGE_REASONS.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                      {changeReason === "Other" && (
                        <textarea
                          value={changeNotes}
                          onChange={(e) => setChangeNotes(e.target.value)}
                          rows={2}
                          placeholder="Please describe the reason…"
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                                     focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      )}
                    </div>
                  )}

                  {/* Save error */}
                  {saveError && (
                    <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">
                      {saveError}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setModalMode("edit");
                        setSaveError("");
                      }}
                      disabled={modalMode === "saving"}
                      className="flex-1 border border-gray-300 text-gray-700 rounded-lg py-2.5 text-sm
                                 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      Go Back
                    </button>
                    {preview.validation.errors.length === 0 && (
                      <button
                        onClick={handleSaveUpdate}
                        disabled={modalMode === "saving"}
                        className="flex-1 bg-green-600 text-white rounded-lg py-2.5 text-sm font-medium
                                   hover:bg-green-700 disabled:opacity-50 transition-colors"
                      >
                        {modalMode === "saving" ? "Saving…" : "Save Update"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
