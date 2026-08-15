"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

// ─── Types ───────────────────────────────────────────────────

interface Employee {
  id: string;
  full_name: string;
  employee_number: string;
  employment_status: string;
}

type RecurrenceType = "NONE" | "NEXT_WEEK" | "WEEKLY_END_OF_MONTH" | "WEEKLY_CUSTOM_END";

interface EmployeeDateStatus {
  employeeId: string;
  employeeName: string;
  date: string;
  status: "available" | "conflict" | "unavailable" | "inactive";
  conflictReason?: string;
  skipped: boolean;
  overridden: boolean;
}

interface RecurringPreview {
  dates: string[];
  employees: EmployeeDateStatus[][];
  totalShifts: number;
}

type Step = "details" | "review" | "confirm";

// ─── Helpers ─────────────────────────────────────────────────

function formatDateDisplay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime12(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

// ─── Component ───────────────────────────────────────────────

export default function NewShiftPage() {
  const router = useRouter();

  // Employee list
  const [employees, setEmployees] = useState<Employee[]>([]);

  // Form state — Step 1: Shift details
  const [form, setForm] = useState({
    date: "",
    startTime: "",
    endTime: "",
    location: "",
    instructions: "",
  });
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>("NONE");
  const [customEndDate, setCustomEndDate] = useState("");
  const [keepSameEmployees, setKeepSameEmployees] = useState(true);

  // Multi-step state
  const [step, setStep] = useState<Step>("details");
  const [preview, setPreview] = useState<RecurringPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Fetch employees on mount
  useEffect(() => {
    fetch("/api/employees")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setEmployees(data.filter((e: Employee) => e.employment_status === "active"));
        }
      });
  }, []);

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleEmployee(id: string) {
    setSelectedEmployees((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  }

  // ─── Step 1 → Step 2: Preview ────────────────────────────

  const handlePreview = useCallback(async () => {
    setError("");

    // Validate
    if (!form.date || !form.startTime || !form.endTime) {
      setError("Date, start time, and finish time are required.");
      return;
    }
    if (selectedEmployees.length === 0) {
      setError("Select at least one employee.");
      return;
    }
    if (form.startTime >= form.endTime) {
      setError("Finish time must be after start time.");
      return;
    }
    if (recurrenceType === "WEEKLY_CUSTOM_END" && !customEndDate) {
      setError("Please select a custom end date.");
      return;
    }
    if (recurrenceType === "WEEKLY_CUSTOM_END" && customEndDate && customEndDate < form.date) {
      setError("End date must be after the shift date.");
      return;
    }

    // For single shift with single employee, use the old simple path
    if (recurrenceType === "NONE" && selectedEmployees.length === 1) {
      // Skip preview, go straight to confirm
      setPreview(null);
      setStep("confirm");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/shifts/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          date: form.date,
          startTime: form.startTime,
          endTime: form.endTime,
          employeeIds: selectedEmployees,
          recurrenceType,
          customEndDate: recurrenceType === "WEEKLY_CUSTOM_END" ? customEndDate : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to generate preview.");
        setLoading(false);
        return;
      }

      setPreview(data.preview);
      setStep("review");
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [form, selectedEmployees, recurrenceType, customEndDate]);

  // ─── Step 2: Toggle skip/override on a conflict ──────────

  function toggleSkip(dateIdx: number, empIdx: number) {
    if (!preview) return;
    const updated = { ...preview };
    const newEmployees = updated.employees.map((dateArr) =>
      dateArr.map((e) => ({ ...e }))
    );
    const item = newEmployees[dateIdx][empIdx];
    item.skipped = !item.skipped;
    updated.employees = newEmployees;
    setPreview(updated);
  }

  function toggleOverride(dateIdx: number, empIdx: number) {
    if (!preview) return;
    const updated = { ...preview };
    const newEmployees = updated.employees.map((dateArr) =>
      dateArr.map((e) => ({ ...e }))
    );
    const item = newEmployees[dateIdx][empIdx];
    item.overridden = !item.overridden;
    updated.employees = newEmployees;
    setPreview(updated);
  }

  // ─── Step 3: Create shifts ───────────────────────────────

  async function handleCreate(saveAsDraft: boolean) {
    setError("");
    setLoading(true);

    try {
      // Simple single shift (no recurrence, one employee)
      if (recurrenceType === "NONE" && selectedEmployees.length === 1 && !preview) {
        const res = await fetch("/api/shifts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: selectedEmployees[0],
            date: form.date,
            startTime: form.startTime,
            endTime: form.endTime,
            location: form.location,
            instructions: form.instructions,
            overrideAvailability: true, // they already confirmed in this flow
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Failed to create shift.");
          setLoading(false);
          return;
        }

        router.push("/admin/roster");
        return;
      }

      // Recurring / multi-employee creation
      const res = await fetch("/api/shifts/recurring", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          date: form.date,
          startTime: form.startTime,
          endTime: form.endTime,
          location: form.location,
          instructions: form.instructions,
          employeeIds: selectedEmployees,
          recurrenceType,
          customEndDate: recurrenceType === "WEEKLY_CUSTOM_END" ? customEndDate : undefined,
          assignments: preview?.employees || null,
          saveAsDraft,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create shifts.");
        setLoading(false);
        return;
      }

      router.push("/admin/roster");
    } catch {
      setError("Something went wrong.");
      setLoading(false);
    }
  }

  // ─── Count valid shifts for confirmation ─────────────────

  function countValidShifts(): number {
    if (!preview) {
      // Single shift
      return selectedEmployees.length;
    }
    let count = 0;
    for (const dateArr of preview.employees) {
      for (const emp of dateArr) {
        if (emp.skipped) continue;
        if (
          (emp.status === "conflict" || emp.status === "unavailable" || emp.status === "inactive") &&
          !emp.overridden
        )
          continue;
        count++;
      }
    }
    return count;
  }

  // ─── Render ──────────────────────────────────────────────

  // Step indicator
  const steps = [
    { key: "details", label: "Shift Details" },
    { key: "review", label: "Review" },
    { key: "confirm", label: "Confirm" },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Create Shift</h1>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                ${
                  step === s.key
                    ? "bg-blue-600 text-white"
                    : steps.findIndex((x) => x.key === step) > i
                    ? "bg-green-500 text-white"
                    : "bg-gray-200 text-gray-500"
                }`}
            >
              {steps.findIndex((x) => x.key === step) > i ? "✓" : i + 1}
            </div>
            <span
              className={`text-sm ${
                step === s.key ? "font-semibold text-gray-900" : "text-gray-400"
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <div className="w-8 h-px bg-gray-300 mx-1" />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">
          {error}
        </div>
      )}

      {/* ═══ STEP 1: SHIFT DETAILS ═══ */}
      {step === "details" && (
        <div className="space-y-4">
          {/* Shift details card */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">Shift Details</h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => updateField("date", e.target.value)}
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Time <span className="text-red-500">*</span>
                </label>
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => updateField("startTime", e.target.value)}
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Finish Time <span className="text-red-500">*</span>
                </label>
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => updateField("endTime", e.target.value)}
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Work Location
              </label>
              <input
                type="text"
                value={form.location}
                onChange={(e) => updateField("location", e.target.value)}
                placeholder="e.g. Main Office, Site A"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Instructions (Optional)
              </label>
              <textarea
                value={form.instructions}
                onChange={(e) => updateField("instructions", e.target.value)}
                rows={3}
                placeholder="Any special instructions for the employee…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Employee selection card */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">
              Select Employees <span className="text-red-500">*</span>
            </h2>
            <p className="text-xs text-gray-500">
              Select one or more employees for this shift.
            </p>

            {employees.length === 0 ? (
              <p className="text-sm text-gray-400">No active employees found.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {employees.map((emp) => (
                  <label
                    key={emp.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                      ${
                        selectedEmployees.includes(emp.id)
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedEmployees.includes(emp.id)}
                      onChange={() => toggleEmployee(emp.id)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {emp.full_name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {emp.employee_number}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {selectedEmployees.length > 0 && (
              <div className="text-xs text-blue-600 font-medium">
                {selectedEmployees.length} employee{selectedEmployees.length > 1 ? "s" : ""} selected
              </div>
            )}
          </div>

          {/* Repeat shift card */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <h2 className="font-semibold text-gray-900">Repeat This Shift?</h2>

            <div className="space-y-2">
              {([
                { value: "NONE", label: "This shift only" },
                { value: "NEXT_WEEK", label: "Repeat next week" },
                { value: "WEEKLY_END_OF_MONTH", label: "Every week until end of this month" },
                { value: "WEEKLY_CUSTOM_END", label: "Every week until custom date" },
              ] as { value: RecurrenceType; label: string }[]).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                    ${
                      recurrenceType === opt.value
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                >
                  <input
                    type="radio"
                    name="recurrence"
                    value={opt.value}
                    checked={recurrenceType === opt.value}
                    onChange={() => setRecurrenceType(opt.value)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-900">{opt.label}</span>
                </label>
              ))}
            </div>

            {recurrenceType === "WEEKLY_CUSTOM_END" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Repeat until <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  min={form.date}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            )}

            {recurrenceType !== "NONE" && (
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={keepSameEmployees}
                  onChange={() => setKeepSameEmployees(!keepSameEmployees)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Keep the same employees for all repeated shifts
              </label>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handlePreview}
              disabled={loading}
              className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium
                         hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Checking…" : recurrenceType === "NONE" && selectedEmployees.length === 1
                ? "Continue"
                : "Preview & Check Conflicts"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/admin/roster")}
              className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium
                         text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ═══ STEP 2: REVIEW / CONFLICT CHECK ═══ */}
      {step === "review" && preview && (
        <div className="space-y-4">
          {/* Summary header */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-3">Repeat Shift Review</h2>
            <div className="text-sm text-gray-600 space-y-1">
              <p>
                <span className="font-medium">Time:</span>{" "}
                {formatTime12(form.startTime)} – {formatTime12(form.endTime)}
              </p>
              {form.location && (
                <p>
                  <span className="font-medium">Location:</span> {form.location}
                </p>
              )}
              <p>
                <span className="font-medium">Employees:</span>{" "}
                {selectedEmployees
                  .map((id) => employees.find((e) => e.id === id)?.full_name)
                  .filter(Boolean)
                  .join(", ")}
              </p>
              <p>
                <span className="font-medium">Repeat:</span>{" "}
                {recurrenceType === "NEXT_WEEK"
                  ? "Next week"
                  : recurrenceType === "WEEKLY_END_OF_MONTH"
                  ? `Every week until end of month`
                  : `Every week until ${formatDateDisplay(customEndDate)}`}
              </p>
            </div>
          </div>

          {/* Per-date conflict details */}
          {preview.dates.map((date, dateIdx) => {
            const dateStatuses = preview.employees[dateIdx];
            const hasConflicts = dateStatuses.some(
              (e) => e.status !== "available"
            );
            return (
              <div
                key={date}
                className={`bg-white rounded-xl border p-4 ${
                  hasConflicts ? "border-yellow-300" : "border-gray-200"
                }`}
              >
                <h3 className="font-semibold text-gray-900 mb-3">
                  {formatDateDisplay(date)}
                </h3>
                <div className="space-y-2">
                  {dateStatuses.map((emp, empIdx) => (
                    <div
                      key={emp.employeeId}
                      className={`flex items-center justify-between p-3 rounded-lg text-sm
                        ${
                          emp.skipped
                            ? "bg-gray-100 text-gray-400 line-through"
                            : emp.status === "available"
                            ? "bg-green-50"
                            : emp.overridden
                            ? "bg-yellow-50"
                            : "bg-red-50"
                        }`}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-medium">
                          {emp.employeeName}
                        </span>
                        {emp.status === "available" && (
                          <span className="ml-2 text-green-600">✓ Available</span>
                        )}
                        {emp.status === "conflict" && !emp.skipped && (
                          <span className="ml-2 text-red-600">
                            ⚠ Conflict: {emp.conflictReason}
                          </span>
                        )}
                        {emp.status === "unavailable" && !emp.skipped && (
                          <span className="ml-2 text-orange-600">
                            ⚠ {emp.conflictReason}
                          </span>
                        )}
                        {emp.status === "inactive" && !emp.skipped && (
                          <span className="ml-2 text-gray-500">
                            ✗ {emp.conflictReason}
                          </span>
                        )}
                        {emp.overridden && (
                          <span className="ml-2 text-yellow-700 font-medium">
                            (Override)
                          </span>
                        )}
                      </div>

                      {/* Actions for non-available */}
                      {emp.status !== "available" && (
                        <div className="flex gap-2 ml-2 flex-shrink-0">
                          <button
                            onClick={() => toggleSkip(dateIdx, empIdx)}
                            className={`px-2 py-1 rounded text-xs font-medium transition-colors
                              ${
                                emp.skipped
                                  ? "bg-gray-300 text-gray-700"
                                  : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                              }`}
                          >
                            {emp.skipped ? "Undo Skip" : "Skip"}
                          </button>
                          {emp.status !== "inactive" && !emp.skipped && (
                            <button
                              onClick={() => toggleOverride(dateIdx, empIdx)}
                              className={`px-2 py-1 rounded text-xs font-medium transition-colors
                                ${
                                  emp.overridden
                                    ? "bg-yellow-400 text-yellow-900"
                                    : "bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                                }`}
                            >
                              {emp.overridden ? "Undo Override" : "Override"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          {/* Navigation buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => {
                setStep("confirm");
              }}
              disabled={countValidShifts() === 0}
              className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium
                         hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Continue ({countValidShifts()} shift{countValidShifts() !== 1 ? "s" : ""})
            </button>
            <button
              onClick={() => setStep("details")}
              className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium
                         text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {/* ═══ STEP 3: FINAL CONFIRMATION ═══ */}
      {step === "confirm" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="font-semibold text-gray-900 mb-4">Confirm Shifts</h2>

            <div className="text-sm text-gray-600 space-y-2 mb-6">
              <p className="text-lg font-bold text-gray-900">
                {countValidShifts()} shift{countValidShifts() !== 1 ? "s" : ""} will be created
              </p>
              <p>
                <span className="font-medium">Time:</span>{" "}
                {formatTime12(form.startTime)} – {formatTime12(form.endTime)}
              </p>
              {form.location && (
                <p>
                  <span className="font-medium">Location:</span> {form.location}
                </p>
              )}
            </div>

            {/* List dates */}
            <div className="space-y-2 mb-6">
              {(preview ? preview.dates : [form.date]).map((date) => (
                <div
                  key={date}
                  className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg p-3"
                >
                  <span className="text-blue-600">📅</span>
                  <span className="font-medium text-gray-900">
                    {formatDateDisplay(date)}
                  </span>
                </div>
              ))}
            </div>

            {/* Employees */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-2">Employees:</h3>
              <div className="flex flex-wrap gap-2">
                {selectedEmployees.map((id) => {
                  const emp = employees.find((e) => e.id === id);
                  return emp ? (
                    <span
                      key={id}
                      className="bg-blue-100 text-blue-800 text-xs font-medium px-2.5 py-1 rounded-full"
                    >
                      {emp.full_name}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="space-y-3">
            <button
              onClick={() => handleCreate(false)}
              disabled={loading}
              className="w-full bg-blue-600 text-white rounded-lg py-3 text-sm font-medium
                         hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading
                ? "Creating…"
                : recurrenceType !== "NONE"
                ? "Publish Repeating Shifts"
                : "Create Shift"}
            </button>

            {recurrenceType !== "NONE" && (
              <button
                onClick={() => handleCreate(true)}
                disabled={loading}
                className="w-full bg-gray-100 text-gray-700 rounded-lg py-3 text-sm font-medium
                           hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400
                           disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? "Saving…" : "Save as Draft"}
              </button>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep(preview ? "review" : "details")}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium
                           text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => router.push("/admin/roster")}
                className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium
                           text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
