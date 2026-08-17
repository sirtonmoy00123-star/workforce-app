"use client";

import { useEffect, useState, useCallback } from "react";
import StatusBadge from "@/components/StatusBadge";

// ─── Types ──────────────────────────────────────────────────

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
  employment_status: string;
}

interface AvailableEmployee {
  id: string;
  full_name: string;
  employee_number: string;
  status: "available" | "partial" | "unavailable" | "conflict";
  reason?: string;
  availabilityWindow?: string;
  weeklyHours: number;
  existingShiftTime?: string;
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

interface CopyPreviewShift {
  originalShiftId: string;
  employeeId: string;
  employeeName: string;
  date: string;
  originalDate: string;
  startTime: string;
  endTime: string;
  location: string | null;
  instructions: string | null;
  status: "ready" | "conflict" | "unavailable" | "inactive";
  reason?: string;
}

type RecurrenceType = "NONE" | "NEXT_WEEK" | "WEEKLY_END_OF_MONTH" | "WEEKLY_CUSTOM_END";

// Change reason presets
const CHANGE_REASONS = [
  "Business requirement changed",
  "Employee requested different time",
  "Staffing adjustment",
  "Site operating hours changed",
  "Other",
];

// ─── Helpers ────────────────────────────────────────────────

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
}

function extractTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatFullDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_LABELS_FULL = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

// Status icons
function statusIcon(status: string): string {
  switch (status) {
    case "accepted": return "✓";
    case "pending": return "⏳";
    case "declined": return "✕";
    case "updated_pending": return "🔄";
    case "working": return "▶";
    case "completed": return "✓";
    case "cancelled": return "✕";
    default: return "";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "accepted": return "Accepted";
    case "pending": return "Pending";
    case "declined": return "Declined";
    case "updated_pending": return "Updated Pending";
    case "working": return "Working";
    case "completed": return "Completed";
    case "cancelled": return "Cancelled";
    default: return status.replace(/_/g, " ");
  }
}

// ─── Component ──────────────────────────────────────────────

export default function RosterPage() {
  const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()));
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  // View mode
  const [viewMode, setViewMode] = useState<"week" | "employee">("week");
  const [selectedEmployeeView, setSelectedEmployeeView] = useState<string | null>(null);

  // Bottom sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetContent, setSheetContent] = useState<
    "shift" | "edit" | "review" | "create1" | "create2" | "create3" |
    "menu" | "copyWeek" | "copyPreview" | "findEmployee" | "pending" | null
  >(null);

  // Selected shift (for shift detail / edit)
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);

  // ── Edit shift state ──
  const [editDate, setEditDate] = useState("");
  const [editStartTime, setEditStartTime] = useState("");
  const [editEndTime, setEditEndTime] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [changeNotes, setChangeNotes] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [saveSuccess, setSaveSuccess] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Create shift state ──
  const [createDate, setCreateDate] = useState("");
  const [createStartTime, setCreateStartTime] = useState("");
  const [createEndTime, setCreateEndTime] = useState("");
  const [createLocation, setCreateLocation] = useState("");
  const [createInstructions, setCreateInstructions] = useState("");
  const [availableEmployees, setAvailableEmployees] = useState<AvailableEmployee[]>([]);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>("NONE");
  const [customEndDate, setCustomEndDate] = useState("");
  const [keepSameEmployees, setKeepSameEmployees] = useState(true);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");

  // ── Copy week state ──
  const [copyPreview, setCopyPreview] = useState<CopyPreviewShift[] | null>(null);
  const [copyTotal, setCopyTotal] = useState(0);
  const [copyReady, setCopyReady] = useState(0);
  const [copyIssues, setCopyIssues] = useState(0);
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [copySuccess, setCopySuccess] = useState("");

  // ── Find employee state ──
  const [findDate, setFindDate] = useState("");
  const [findStartTime, setFindStartTime] = useState("");
  const [findEndTime, setFindEndTime] = useState("");
  const [findResults, setFindResults] = useState<AvailableEmployee[]>([]);
  const [findLoading, setFindLoading] = useState(false);

  // Computed
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const today = formatDate(new Date());

  // ── Data loading ──
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

  // ── Week navigation ──
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
  function goToday() {
    setWeekStart(getMonday(new Date()));
  }

  // ── Weekly summary ──
  const totalShifts = shifts.length;
  const pendingCount = shifts.filter((s) => s.status === "pending" || s.status === "updated_pending").length;
  const declinedCount = shifts.filter((s) => s.status === "declined").length;

  // ── Close bottom sheet ──
  function closeSheet() {
    setSheetOpen(false);
    setSheetContent(null);
    setSelectedShift(null);
    setPreview(null);
    setReviewError("");
    setSaveSuccess("");
    setSaveError("");
    setCreateError("");
    setCreateSuccess("");
    setCopyError("");
    setCopySuccess("");
  }

  // ── Open shift detail ──
  function openShift(shift: Shift) {
    setSelectedShift(shift);
    setSheetContent("shift");
    setSheetOpen(true);
    setSaveSuccess("");
    setSaveError("");
    setReviewError("");
    setPreview(null);
    setChangeReason("");
    setChangeNotes("");
    setOverrideReason("");
  }

  // ── Edit shift ──
  function startEditing() {
    if (!selectedShift) return;
    if (selectedShift.status === "completed") {
      setReviewError("This shift has been completed. Use Timesheet Correction to change actual working records.");
      return;
    }
    setEditDate(selectedShift.date);
    setEditStartTime(extractTime(selectedShift.scheduled_start));
    setEditEndTime(extractTime(selectedShift.scheduled_finish));
    setEditLocation(selectedShift.location || "");
    setEditInstructions(selectedShift.instructions || "");
    setSheetContent("edit");
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
          setSheetContent("review");
        } else {
          setReviewError(data.error || "Validation failed.");
        }
        return;
      }
      setPreview(data);
      setSheetContent("review");
    } catch {
      setReviewError("Something went wrong. Please try again.");
    }
  }

  async function handleSaveUpdate() {
    if (!selectedShift || !preview) return;
    setSaveError("");
    setSaving(true);

    if (!changeReason) {
      setSaveError("Please select a reason for this change.");
      setSaving(false);
      return;
    }
    if (preview.validation.warnings.length > 0 && !overrideReason) {
      setSaveError("Please provide an override reason for the warnings.");
      setSaving(false);
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
        setSaving(false);
        return;
      }

      // Update local state
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
      setSaving(false);
      setSheetContent("shift");
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
      setSaving(false);
    }
  }

  // ── Create shift ──
  function openCreate(preselectedDate?: string) {
    setCreateDate(preselectedDate || formatDate(weekDates[0]));
    setCreateStartTime("");
    setCreateEndTime("");
    setCreateLocation("");
    setCreateInstructions("");
    setSelectedEmployeeIds([]);
    setAvailableEmployees([]);
    setEmployeeSearch("");
    setShowAvailableOnly(false);
    setRecurrenceType("NONE");
    setCustomEndDate("");
    setKeepSameEmployees(true);
    setCreateError("");
    setCreateSuccess("");
    setSheetContent("create1");
    setSheetOpen(true);
  }

  function goToStep2() {
    if (!createDate || !createStartTime || !createEndTime) {
      setCreateError("Date, start time, and finish time are required.");
      return;
    }
    if (createStartTime >= createEndTime) {
      setCreateError("Finish time must be after start time.");
      return;
    }
    setCreateError("");
    setSheetContent("create2");
    fetchAvailableEmployees();
  }

  const fetchAvailableEmployees = useCallback(async () => {
    setLoadingEmployees(true);
    try {
      const res = await fetch(
        `/api/roster/available-employees?date=${createDate}&startTime=${createStartTime}&endTime=${createEndTime}`
      );
      const data = await res.json();
      if (Array.isArray(data)) setAvailableEmployees(data);
    } catch { /* ignore */ }
    setLoadingEmployees(false);
  }, [createDate, createStartTime, createEndTime]);

  function toggleEmployee(id: string) {
    setSelectedEmployeeIds((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  }

  function goToStep3() {
    if (selectedEmployeeIds.length === 0) {
      setCreateError("Select at least one employee.");
      return;
    }
    setCreateError("");
    setSheetContent("create3");
  }

  async function handlePublishShift() {
    setCreateError("");
    setCreateLoading(true);

    try {
      if (recurrenceType === "NONE" && selectedEmployeeIds.length === 1) {
        // Simple single shift
        const res = await fetch("/api/shifts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: selectedEmployeeIds[0],
            date: createDate,
            startTime: createStartTime,
            endTime: createEndTime,
            location: createLocation,
            instructions: createInstructions,
            overrideAvailability: true,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setCreateError(data.error || "Failed to create shift.");
          setCreateLoading(false);
          return;
        }
      } else {
        // Multi-employee or recurring
        const res = await fetch("/api/shifts/recurring", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            date: createDate,
            startTime: createStartTime,
            endTime: createEndTime,
            location: createLocation,
            instructions: createInstructions,
            employeeIds: selectedEmployeeIds,
            recurrenceType,
            customEndDate: recurrenceType === "WEEKLY_CUSTOM_END" ? customEndDate : undefined,
            assignments: null,
            saveAsDraft: false,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setCreateError(data.error || "Failed to create shifts.");
          setCreateLoading(false);
          return;
        }
      }

      setCreateSuccess(
        `Shift created for ${selectedEmployeeIds.length} employee${selectedEmployeeIds.length > 1 ? "s" : ""}`
      );
      setCreateLoading(false);

      // Refresh shifts
      const startDate = formatDate(weekDates[0]);
      const endDate = formatDate(weekDates[6]);
      const res = await fetch(`/api/shifts?startDate=${startDate}&endDate=${endDate}`);
      const newShifts = await res.json();
      if (Array.isArray(newShifts)) setShifts(newShifts);

      // Show success briefly then close
      setTimeout(() => {
        closeSheet();
      }, 1500);
    } catch {
      setCreateError("Something went wrong.");
      setCreateLoading(false);
    }
  }

  // ── Copy Last Week ──
  async function handleCopyWeekPreview() {
    setCopyLoading(true);
    setCopyError("");
    const prevMonday = new Date(weekStart);
    prevMonday.setDate(prevMonday.getDate() - 7);

    try {
      const res = await fetch("/api/roster/copy-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preview",
          fromWeekStart: formatDate(prevMonday),
          toWeekStart: formatDate(weekStart),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCopyError(data.error || "Failed to preview.");
        setCopyLoading(false);
        return;
      }
      setCopyPreview(data.shifts);
      setCopyTotal(data.total);
      setCopyReady(data.ready);
      setCopyIssues(data.issues);
      setSheetContent("copyPreview");
      setCopyLoading(false);
    } catch {
      setCopyError("Something went wrong.");
      setCopyLoading(false);
    }
  }

  async function handleCopyWeekCreate() {
    setCopyLoading(true);
    setCopyError("");
    const prevMonday = new Date(weekStart);
    prevMonday.setDate(prevMonday.getDate() - 7);

    try {
      const readyIds = (copyPreview || []).filter((p) => p.status === "ready").map((p) => p.originalShiftId);
      const res = await fetch("/api/roster/copy-week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          fromWeekStart: formatDate(prevMonday),
          toWeekStart: formatDate(weekStart),
          selectedShiftIds: readyIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCopyError(data.error || "Failed to copy.");
        setCopyLoading(false);
        return;
      }
      setCopySuccess(`${data.created} shifts copied successfully.`);
      setCopyLoading(false);

      // Refresh
      const startDate = formatDate(weekDates[0]);
      const endDate = formatDate(weekDates[6]);
      const refreshRes = await fetch(`/api/shifts?startDate=${startDate}&endDate=${endDate}`);
      const newShifts = await refreshRes.json();
      if (Array.isArray(newShifts)) setShifts(newShifts);

      setTimeout(closeSheet, 1500);
    } catch {
      setCopyError("Something went wrong.");
      setCopyLoading(false);
    }
  }

  // ── Find Employee ──
  async function handleFindEmployee(date: string, startTime: string, endTime: string) {
    setFindDate(date);
    setFindStartTime(startTime);
    setFindEndTime(endTime);
    setSheetContent("findEmployee");
    setSheetOpen(true);
    setFindLoading(true);

    try {
      const res = await fetch(
        `/api/roster/available-employees?date=${date}&startTime=${startTime}&endTime=${endTime}`
      );
      const data = await res.json();
      if (Array.isArray(data)) setFindResults(data);
    } catch { /* ignore */ }
    setFindLoading(false);
  }

  async function handleQuickAssign(employeeId: string) {
    setFindLoading(true);
    try {
      const res = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          date: findDate,
          startTime: findStartTime,
          endTime: findEndTime,
          overrideAvailability: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data.error || "Failed to assign.");
        setFindLoading(false);
        return;
      }

      // Refresh
      const startDate = formatDate(weekDates[0]);
      const endDate = formatDate(weekDates[6]);
      const refreshRes = await fetch(`/api/shifts?startDate=${startDate}&endDate=${endDate}`);
      const newShifts = await refreshRes.json();
      if (Array.isArray(newShifts)) setShifts(newShifts);

      closeSheet();
    } catch {
      setFindLoading(false);
    }
  }

  // ── Build shift map ──
  const shiftMap: Record<string, Record<string, Shift[]>> = {};
  shifts.forEach((s) => {
    if (!shiftMap[s.employee_id]) shiftMap[s.employee_id] = {};
    if (!shiftMap[s.employee_id][s.date]) shiftMap[s.employee_id][s.date] = [];
    shiftMap[s.employee_id][s.date].push(s);
  });

  // Filtered employees for create step 2
  const filteredAvailableEmployees = availableEmployees.filter((emp) => {
    if (employeeSearch && !emp.full_name.toLowerCase().includes(employeeSearch.toLowerCase())) return false;
    if (showAvailableOnly && emp.status !== "available") return false;
    return true;
  });

  // ─── RENDER ──────────────────────────────────────────────────

  return (
    <div className="relative pb-20 md:pb-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Weekly Roster</h1>
        <div className="flex items-center gap-2">
          {/* ••• Menu (mobile) */}
          <button
            onClick={() => { setSheetContent("menu"); setSheetOpen(true); }}
            className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200
                       text-gray-600 hover:bg-gray-50 text-lg"
            title="Roster Tools"
          >
            •••
          </button>
          {/* Desktop menu items */}
          <button
            onClick={() => { setSheetContent("menu"); setSheetOpen(true); }}
            className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200
                       text-sm text-gray-700 hover:bg-gray-50"
          >
            🔧 Tools
          </button>
          <button
            onClick={() => openCreate()}
            className="hidden md:inline-flex bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium
                       hover:bg-blue-700 transition-colors"
          >
            + Create Shift
          </button>
        </div>
      </div>

      {/* ── Week Navigation ── */}
      <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-3 py-2.5 mb-3">
        <button onClick={prevWeek} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg text-lg">‹</button>
        <button onClick={goToday} className="text-sm font-medium text-gray-900 hover:text-blue-600">
          {formatShortDate(weekDates[0])} – {formatShortDate(weekDates[6])}
          {weekDates[0] <= new Date() && weekDates[6] >= new Date() && (
            <span className="ml-1.5 text-xs text-blue-600 font-normal">(This week)</span>
          )}
        </button>
        <button onClick={nextWeek} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg text-lg">›</button>
      </div>

      {/* ── Today + Shift buttons (mobile) ── */}
      <div className="flex items-center gap-2 mb-3 md:hidden">
        <button
          onClick={goToday}
          className="px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
        >
          Today
        </button>
      </div>

      {/* ── Weekly Summary ── */}
      <div className="bg-white rounded-lg border border-gray-200 px-4 py-3 mb-4">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">This Week</div>
        <div className="flex items-center gap-4 text-sm">
          <span className="font-semibold text-gray-900">{totalShifts} Shifts</span>
          {pendingCount > 0 ? (
            <button
              onClick={() => { setSheetContent("pending"); setSheetOpen(true); }}
              className="text-amber-600 font-medium hover:underline"
            >
              {pendingCount} Pending
            </button>
          ) : (
            <span className="text-gray-500">0 Pending</span>
          )}
          {declinedCount > 0 && (
            <span className="text-red-600 font-medium">⚠ {declinedCount} Declined</span>
          )}
          {pendingCount === 0 && declinedCount === 0 && totalShifts > 0 && (
            <span className="text-green-600 font-medium">✓ All Confirmed</span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading roster…</div>
      ) : totalShifts === 0 && employees.length > 0 ? (
        /* ── Empty week ── */
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="text-gray-400 text-4xl mb-3">📋</div>
          <p className="text-gray-600 font-medium mb-1">No roster created yet</p>
          <p className="text-gray-400 text-sm mb-4">Start building this week&apos;s schedule</p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              onClick={() => { setSheetContent("copyWeek"); setSheetOpen(true); }}
              className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              📋 Copy Last Week
            </button>
            <button
              onClick={() => openCreate()}
              className="px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              + Create First Shift
            </button>
          </div>
        </div>
      ) : employees.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500">No employees yet.</p>
        </div>
      ) : viewMode === "employee" && selectedEmployeeView ? (
        /* ── Employee View ── */
        <div>
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => { setViewMode("week"); setSelectedEmployeeView(null); }}
              className="text-sm text-blue-600 hover:underline"
            >
              ← Back to Week
            </button>
          </div>
          {(() => {
            const emp = employees.find((e) => e.id === selectedEmployeeView);
            if (!emp) return null;
            const empShifts = shifts.filter((s) => s.employee_id === emp.id);
            const totalHours = empShifts.reduce((acc, s) => {
              return acc + (new Date(s.scheduled_finish).getTime() - new Date(s.scheduled_start).getTime()) / (1000 * 60 * 60);
            }, 0);
            return (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-bold text-gray-900">{emp.full_name}</h2>
                  <span className="text-sm text-gray-500">{Math.round(totalHours * 10) / 10}h this week</span>
                </div>
                <div className="space-y-2">
                  {weekDates.map((d, i) => {
                    const dateStr = formatDate(d);
                    const dayShifts = shiftMap[emp.id]?.[dateStr] || [];
                    const isToday = dateStr === today;
                    return (
                      <div key={i} className={`rounded-lg p-3 ${isToday ? "bg-blue-50 border border-blue-200" : "bg-gray-50"}`}>
                        <div className="text-xs font-semibold text-gray-500 mb-1">
                          {DAY_LABELS_FULL[i]} {formatShortDate(d).toUpperCase()}
                        </div>
                        {dayShifts.length === 0 ? (
                          <span className="text-sm text-gray-400">Off</span>
                        ) : (
                          dayShifts.map((s) => (
                            <button
                              key={s.id}
                              onClick={() => openShift(s)}
                              className="w-full text-left flex items-center justify-between text-sm py-1"
                            >
                              <span>
                                {formatTime(s.scheduled_start)} – {formatTime(s.scheduled_finish)}
                                {s.location && <span className="text-gray-500 ml-1">· {s.location}</span>}
                              </span>
                              <StatusBadge status={s.status} />
                            </button>
                          ))
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        <>
          {/* ── Desktop table ── */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-3 py-3 font-medium text-gray-600 w-36">Employee</th>
                    {weekDates.map((d, i) => {
                      const isToday = formatDate(d) === today;
                      return (
                        <th key={i} className={`text-center px-2 py-3 font-medium ${isToday ? "text-blue-600 bg-blue-50" : "text-gray-600"}`}>
                          <div>{DAY_LABELS[i]}</div>
                          <div className="text-xs font-normal">{formatShortDate(d)}</div>
                        </th>
                      );
                    })}
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
                                  onClick={() => openShift(s)}
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

          {/* ── Mobile Day Cards ── */}
          <div className="md:hidden space-y-3">
            {weekDates.map((d, i) => {
              const dateStr = formatDate(d);
              const dayShifts = shifts.filter((s) => s.date === dateStr);
              const isToday = dateStr === today;
              const dayPending = dayShifts.filter((s) => s.status === "pending" || s.status === "updated_pending").length;
              const dayDeclined = dayShifts.filter((s) => s.status === "declined").length;

              return (
                <div
                  key={i}
                  className={`bg-white rounded-xl border p-4 ${
                    isToday ? "border-blue-300 ring-1 ring-blue-100" : "border-gray-200"
                  }`}
                >
                  {/* Day header */}
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-sm font-bold text-gray-900">
                        {DAY_LABELS_FULL[i]} {d.getDate()} {d.toLocaleDateString("en-AU", { month: "short" }).toUpperCase()}
                      </span>
                      {isToday && (
                        <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">TODAY</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500">
                      {dayShifts.length > 0 && (
                        <span>
                          {dayShifts.length} shift{dayShifts.length !== 1 ? "s" : ""}
                          {dayPending > 0 && <span className="text-amber-600 ml-1">· {dayPending} pending</span>}
                          {dayDeclined > 0 && <span className="text-red-600 ml-1">· ⚠ {dayDeclined} declined</span>}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Shifts */}
                  {dayShifts.length === 0 ? (
                    <div className="py-4 text-center">
                      <p className="text-sm text-gray-400 mb-2">No shifts scheduled</p>
                      <button
                        onClick={() => openCreate(dateStr)}
                        className="text-sm text-blue-600 font-medium hover:underline"
                      >
                        + Add Shift
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {dayShifts.map((s) => {
                        const emp = employees.find((e) => e.id === s.employee_id);
                        const sIcon = statusIcon(s.status);
                        const statusColor =
                          s.status === "accepted" || s.status === "completed" ? "text-green-600" :
                          s.status === "pending" ? "text-amber-600" :
                          s.status === "updated_pending" ? "text-amber-700" :
                          s.status === "declined" ? "text-red-600" :
                          s.status === "working" ? "text-purple-600" : "text-gray-500";

                        return (
                          <button
                            key={s.id}
                            onClick={() => openShift(s)}
                            className="w-full text-left p-3 rounded-lg hover:bg-gray-50 active:bg-gray-100
                                       transition-colors border border-transparent hover:border-gray-200"
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 text-sm">{emp?.full_name}</div>
                                <div className="text-sm text-gray-600 mt-0.5">
                                  {formatTime(s.scheduled_start)} – {formatTime(s.scheduled_finish)}
                                </div>
                                {s.location && (
                                  <div className="text-xs text-gray-500 mt-0.5">📍 {s.location}</div>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
                                <span className={`text-xs font-medium ${statusColor}`}>
                                  {sIcon} {statusLabel(s.status)}
                                </span>
                                <span className="text-gray-300 text-sm">›</span>
                              </div>
                            </div>
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

      {/* ── Sticky + Shift Button (mobile) ── */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-gray-100 via-gray-100 to-transparent pb-safe z-40">
        <button
          onClick={() => openCreate()}
          className="w-full bg-blue-600 text-white rounded-xl py-3.5 text-sm font-semibold
                     hover:bg-blue-700 active:bg-blue-800 transition-colors shadow-lg shadow-blue-200"
        >
          + Shift
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════
          BOTTOM SHEET
         ══════════════════════════════════════════════════════════ */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50" onClick={closeSheet}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40" />

          {/* Sheet */}
          <div
            className="absolute bottom-0 left-0 right-0 md:inset-0 md:flex md:items-center md:justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-white rounded-t-2xl md:rounded-2xl w-full md:max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
              {/* Handle */}
              <div className="md:hidden flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 bg-gray-300 rounded-full" />
              </div>

              <div className="p-5">
                {/* ── SHIFT DETAIL ── */}
                {sheetContent === "shift" && selectedShift && (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-bold text-gray-900">
                        {employees.find((e) => e.id === selectedShift.employee_id)?.full_name}
                      </h2>
                      <button onClick={closeSheet} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
                    </div>

                    {saveSuccess && (
                      <div className="bg-green-50 text-green-700 text-sm rounded-lg p-3 border border-green-200 mb-4">
                        {saveSuccess}
                      </div>
                    )}

                    <div className="space-y-3 text-sm mb-6">
                      <div className="text-gray-600">{formatFullDate(selectedShift.date)}</div>
                      <div className="text-lg font-semibold text-gray-900">
                        {formatTime(selectedShift.scheduled_start)} – {formatTime(selectedShift.scheduled_finish)}
                      </div>
                      {selectedShift.location && (
                        <div className="text-gray-600">📍 {selectedShift.location}</div>
                      )}
                      {selectedShift.instructions && (
                        <div className="text-gray-500 text-xs bg-gray-50 rounded-lg p-2">
                          📝 {selectedShift.instructions}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Status:</span>
                        <StatusBadge status={selectedShift.status} />
                      </div>
                      {selectedShift.recurring_group_id && (
                        <div className="text-xs text-purple-600 bg-purple-50 rounded-lg p-2">
                          🔁 Part of a recurring series
                        </div>
                      )}
                    </div>

                    {reviewError && (
                      <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">
                        {reviewError}
                      </div>
                    )}

                    <div className="space-y-2">
                      {selectedShift.status !== "completed" && selectedShift.status !== "cancelled" && (
                        <button onClick={startEditing}
                          className="w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-blue-700">
                          ✏️ Edit Shift
                        </button>
                      )}
                      {selectedShift.status === "declined" && (
                        <button
                          onClick={() => handleFindEmployee(selectedShift.date, extractTime(selectedShift.scheduled_start), extractTime(selectedShift.scheduled_finish))}
                          className="w-full border border-blue-300 text-blue-700 rounded-xl py-3 text-sm font-medium hover:bg-blue-50"
                        >
                          🔍 Find Replacement
                        </button>
                      )}
                      <button onClick={closeSheet}
                        className="w-full border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-medium hover:bg-gray-50">
                        Close
                      </button>
                    </div>
                  </>
                )}

                {/* ── EDIT SHIFT ── */}
                {sheetContent === "edit" && selectedShift && (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-bold text-gray-900">Edit Shift</h2>
                      <button onClick={closeSheet} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
                    </div>
                    <div className="text-sm text-gray-500 mb-4">
                      {employees.find((e) => e.id === selectedShift.employee_id)?.full_name}
                    </div>

                    {selectedShift.recurring_group_id && (
                      <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-4 text-sm text-purple-800">
                        🔁 Editing this shift only (part of recurring series)
                      </div>
                    )}

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                        <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)}
                          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                          <input type="time" value={editStartTime} onChange={(e) => setEditStartTime(e.target.value)}
                            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Finish Time</label>
                          <input type="time" value={editEndTime} onChange={(e) => setEditEndTime(e.target.value)}
                            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                        <input type="text" value={editLocation} onChange={(e) => setEditLocation(e.target.value)}
                          placeholder="e.g. Campbelltown"
                          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Instructions</label>
                        <textarea value={editInstructions} onChange={(e) => setEditInstructions(e.target.value)} rows={2}
                          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    </div>

                    {reviewError && (
                      <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mt-4">{reviewError}</div>
                    )}

                    <div className="flex gap-3 mt-6">
                      <button onClick={() => setSheetContent("shift")}
                        className="flex-1 border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-medium hover:bg-gray-50">
                        Cancel
                      </button>
                      <button onClick={handleReviewUpdate}
                        className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-blue-700">
                        Review Update
                      </button>
                    </div>
                  </>
                )}

                {/* ── REVIEW EDIT ── */}
                {sheetContent === "review" && preview && selectedShift && (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-bold text-gray-900">Review Update</h2>
                      <button onClick={closeSheet} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
                    </div>

                    {/* Change summary */}
                    <div className="bg-gray-50 rounded-xl p-4 mb-4 text-sm">
                      <div className="font-medium text-gray-900 mb-2">
                        {preview.employee?.full_name || employees.find((e) => e.id === selectedShift.employee_id)?.full_name}
                      </div>
                      <div className="space-y-1 text-gray-600">
                        {preview.original.date !== editDate && (
                          <div>
                            <span className="line-through text-red-500 mr-1">{formatFullDate(preview.original.date)}</span>
                            → {formatFullDate(editDate)}
                          </div>
                        )}
                        <div className="text-gray-400">
                          Previous: {formatTime(preview.original.scheduled_start)} – {formatTime(preview.original.scheduled_finish)}
                        </div>
                        <div className="text-blue-600 font-medium">
                          New: {formatHHMM(editStartTime)} – {formatHHMM(editEndTime)}
                        </div>
                      </div>
                    </div>

                    {/* Validation */}
                    <div className="space-y-2 mb-4">
                      {preview.validation.errors.map((err, i) => (
                        <div key={`err-${i}`} className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm">
                          <span className="text-red-500">✕</span> <span className="font-medium text-red-800">{err.message}</span>
                          {err.details && <div className="text-xs text-red-600 mt-0.5">{err.details}</div>}
                        </div>
                      ))}
                      {preview.validation.warnings.map((warn, i) => (
                        <div key={`warn-${i}`} className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                          <span className="text-amber-500">⚠</span> <span className="font-medium text-amber-800">{warn.message}</span>
                          {warn.details && <div className="text-xs text-amber-600 mt-0.5">{warn.details}</div>}
                        </div>
                      ))}
                      {preview.validation.errors.length === 0 && preview.validation.warnings.length === 0 && (
                        <div className="text-sm text-green-700 space-y-1">
                          <div>✓ Employee active</div>
                          <div>✓ No shift overlap</div>
                          <div>✓ Availability valid</div>
                        </div>
                      )}
                      {preview.needsReconfirmation && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                          <span className="font-medium">Employee reconfirmation required.</span>
                          <div className="text-xs mt-0.5">Status will change to &quot;Updated — Awaiting Confirmation&quot;.</div>
                        </div>
                      )}
                    </div>

                    {/* Override reason */}
                    {preview.validation.warnings.length > 0 && preview.validation.errors.length === 0 && (
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Override Reason *</label>
                        <textarea value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} rows={2}
                          placeholder="e.g. Employee confirmed directly"
                          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    )}

                    {/* Change reason */}
                    {preview.validation.errors.length === 0 && (
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Reason for Change *</label>
                        <select value={changeReason} onChange={(e) => setChangeReason(e.target.value)}
                          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2">
                          <option value="">Select a reason…</option>
                          {CHANGE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                        {changeReason === "Other" && (
                          <textarea value={changeNotes} onChange={(e) => setChangeNotes(e.target.value)} rows={2}
                            placeholder="Please describe the reason…"
                            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        )}
                      </div>
                    )}

                    {saveError && (
                      <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">{saveError}</div>
                    )}

                    <div className="flex gap-3">
                      <button onClick={() => { setSheetContent("edit"); setSaveError(""); }}
                        disabled={saving}
                        className="flex-1 border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
                        Go Back
                      </button>
                      {preview.validation.errors.length === 0 && (
                        <button onClick={handleSaveUpdate} disabled={saving}
                          className="flex-1 bg-green-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-green-700 disabled:opacity-50">
                          {saving ? "Saving…" : "Save Update"}
                        </button>
                      )}
                    </div>
                  </>
                )}

                {/* ── CREATE STEP 1: When & Where ── */}
                {sheetContent === "create1" && (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-lg font-bold text-gray-900">Create Shift</h2>
                        <div className="text-xs text-gray-400">Step 1 of 3</div>
                      </div>
                      <button onClick={closeSheet} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                        <input type="date" value={createDate} onChange={(e) => setCreateDate(e.target.value)}
                          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Start *</label>
                          <input type="time" value={createStartTime} onChange={(e) => setCreateStartTime(e.target.value)}
                            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Finish *</label>
                          <input type="time" value={createEndTime} onChange={(e) => setCreateEndTime(e.target.value)}
                            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                        <input type="text" value={createLocation} onChange={(e) => setCreateLocation(e.target.value)}
                          placeholder="e.g. St Helens"
                          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Instructions (optional)</label>
                        <textarea value={createInstructions} onChange={(e) => setCreateInstructions(e.target.value)} rows={2}
                          placeholder="Any special instructions…"
                          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      </div>
                    </div>

                    {createError && (
                      <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mt-4">{createError}</div>
                    )}

                    <button onClick={goToStep2}
                      className="w-full mt-6 bg-blue-600 text-white rounded-xl py-3.5 text-sm font-medium hover:bg-blue-700">
                      Continue
                    </button>
                  </>
                )}

                {/* ── CREATE STEP 2: Choose Employees ── */}
                {sheetContent === "create2" && (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h2 className="text-lg font-bold text-gray-900">Choose Employees</h2>
                        <div className="text-xs text-gray-400">Step 2 of 3</div>
                      </div>
                      <button onClick={closeSheet} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
                    </div>

                    <div className="text-sm text-gray-600 mb-3">
                      {formatFullDate(createDate)} · {formatHHMM(createStartTime)} – {formatHHMM(createEndTime)}
                    </div>

                    {selectedEmployeeIds.length > 0 && (
                      <div className="text-sm font-medium text-blue-600 mb-3">
                        {selectedEmployeeIds.length} selected
                      </div>
                    )}

                    {/* Search + filter */}
                    <div className="flex gap-2 mb-3">
                      <input
                        type="text"
                        value={employeeSearch}
                        onChange={(e) => setEmployeeSearch(e.target.value)}
                        placeholder="Search employee…"
                        className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        onClick={() => setShowAvailableOnly(!showAvailableOnly)}
                        className={`px-3 py-2 rounded-xl text-xs font-medium border ${
                          showAvailableOnly ? "bg-green-50 border-green-300 text-green-700" : "border-gray-300 text-gray-600"
                        }`}
                      >
                        Available
                      </button>
                    </div>

                    {loadingEmployees ? (
                      <div className="text-center py-8 text-gray-500 text-sm">Finding available employees…</div>
                    ) : (
                      <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
                        {/* Available section */}
                        {filteredAvailableEmployees.filter((e) => e.status === "available").length > 0 && (
                          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-1 pb-1">Available</div>
                        )}
                        {filteredAvailableEmployees.filter((e) => e.status === "available").map((emp) => (
                          <label key={emp.id}
                            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                              selectedEmployeeIds.includes(emp.id) ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"
                            }`}>
                            <input type="checkbox" checked={selectedEmployeeIds.includes(emp.id)}
                              onChange={() => toggleEmployee(emp.id)}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-900">{emp.full_name}</div>
                              <div className="text-xs text-gray-500">
                                {emp.availabilityWindow ? `Available ${emp.availabilityWindow}` : emp.reason || "Available"}
                                <span className="ml-2 text-gray-400">{emp.weeklyHours}h this week</span>
                              </div>
                            </div>
                          </label>
                        ))}

                        {/* Partial section */}
                        {filteredAvailableEmployees.filter((e) => e.status === "partial").length > 0 && (
                          <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-3 pb-1">Partially Available</div>
                        )}
                        {filteredAvailableEmployees.filter((e) => e.status === "partial").map((emp) => (
                          <label key={emp.id}
                            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                              selectedEmployeeIds.includes(emp.id) ? "border-amber-400 bg-amber-50" : "border-gray-200 hover:border-gray-300"
                            }`}>
                            <input type="checkbox" checked={selectedEmployeeIds.includes(emp.id)}
                              onChange={() => toggleEmployee(emp.id)}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-900">{emp.full_name}</div>
                              <div className="text-xs text-amber-600">{emp.reason}</div>
                              <div className="text-xs text-gray-400">{emp.weeklyHours}h this week</div>
                            </div>
                          </label>
                        ))}

                        {/* Unavailable section */}
                        {!showAvailableOnly && filteredAvailableEmployees.filter((e) => e.status === "unavailable" || e.status === "conflict").length > 0 && (
                          <>
                            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-3 pb-1">Not Available</div>
                            {filteredAvailableEmployees.filter((e) => e.status === "unavailable" || e.status === "conflict").map((emp) => (
                              <label key={emp.id}
                                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors opacity-60 ${
                                  selectedEmployeeIds.includes(emp.id) ? "border-red-300 bg-red-50" : "border-gray-200"
                                }`}>
                                <input type="checkbox" checked={selectedEmployeeIds.includes(emp.id)}
                                  onChange={() => toggleEmployee(emp.id)}
                                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-900">{emp.full_name}</div>
                                  <div className="text-xs text-red-600">{emp.reason}</div>
                                  <div className="text-xs text-gray-400">{emp.weeklyHours}h this week</div>
                                </div>
                              </label>
                            ))}
                          </>
                        )}
                      </div>
                    )}

                    {createError && (
                      <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mt-4">{createError}</div>
                    )}

                    <div className="flex gap-3 mt-4">
                      <button onClick={() => setSheetContent("create1")}
                        className="flex-1 border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-medium hover:bg-gray-50">
                        Back
                      </button>
                      <button onClick={goToStep3}
                        className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-blue-700">
                        Continue ({selectedEmployeeIds.length})
                      </button>
                    </div>
                  </>
                )}

                {/* ── CREATE STEP 3: Review & Publish ── */}
                {sheetContent === "create3" && (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-lg font-bold text-gray-900">Review Shift</h2>
                        <div className="text-xs text-gray-400">Step 3 of 3</div>
                      </div>
                      <button onClick={closeSheet} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
                    </div>

                    <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-2 text-sm">
                      <div className="font-semibold text-gray-900">{formatFullDate(createDate)}</div>
                      <div className="text-gray-700">{formatHHMM(createStartTime)} – {formatHHMM(createEndTime)}</div>
                      {createLocation && <div className="text-gray-600">📍 {createLocation}</div>}
                    </div>

                    <div className="mb-4">
                      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Employees</div>
                      <div className="space-y-1.5">
                        {selectedEmployeeIds.map((id) => {
                          const emp = availableEmployees.find((e) => e.id === id) || employees.find((e) => e.id === id);
                          return emp ? (
                            <div key={id} className="flex items-center justify-between bg-blue-50 rounded-lg p-2.5 text-sm">
                              <span className="font-medium text-gray-900">{emp.full_name}</span>
                              <button onClick={() => toggleEmployee(id)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                            </div>
                          ) : null;
                        })}
                      </div>
                    </div>

                    {/* Repeat settings */}
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Repeat</div>
                      <div className="space-y-1.5">
                        {([
                          { value: "NONE" as RecurrenceType, label: "This shift only" },
                          { value: "NEXT_WEEK" as RecurrenceType, label: "Repeat next week" },
                          { value: "WEEKLY_END_OF_MONTH" as RecurrenceType, label: "Every week until end of month" },
                          { value: "WEEKLY_CUSTOM_END" as RecurrenceType, label: "Custom end date" },
                        ]).map((opt) => (
                          <label key={opt.value}
                            className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer text-sm ${
                              recurrenceType === opt.value ? "border-blue-500 bg-blue-50" : "border-gray-200"
                            }`}>
                            <input type="radio" name="recurrence" value={opt.value}
                              checked={recurrenceType === opt.value}
                              onChange={() => setRecurrenceType(opt.value)}
                              className="text-blue-600 focus:ring-blue-500" />
                            <span>{opt.label}</span>
                          </label>
                        ))}
                      </div>

                      {recurrenceType === "WEEKLY_CUSTOM_END" && (
                        <input type="date" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)}
                          min={createDate}
                          className="w-full mt-2 rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      )}

                      {recurrenceType !== "NONE" && (
                        <label className="flex items-center gap-2 mt-2 text-sm text-gray-700 cursor-pointer">
                          <input type="checkbox" checked={keepSameEmployees}
                            onChange={() => setKeepSameEmployees(!keepSameEmployees)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                          Keep same employees for all
                        </label>
                      )}
                    </div>

                    {createSuccess && (
                      <div className="bg-green-50 text-green-700 text-sm rounded-lg p-3 border border-green-200 mb-4">
                        ✓ {createSuccess}
                      </div>
                    )}

                    {createError && (
                      <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">{createError}</div>
                    )}

                    <div className="space-y-2">
                      <button onClick={handlePublishShift} disabled={createLoading}
                        className="w-full bg-blue-600 text-white rounded-xl py-3.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                        {createLoading ? "Creating…" : "Publish Shift"}
                      </button>
                      <button onClick={() => setSheetContent("create2")}
                        className="w-full border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-medium hover:bg-gray-50">
                        Back
                      </button>
                    </div>
                  </>
                )}

                {/* ── ROSTER TOOLS MENU ── */}
                {sheetContent === "menu" && (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-bold text-gray-900">Roster Tools</h2>
                      <button onClick={closeSheet} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
                    </div>
                    <div className="space-y-1.5">
                      <button onClick={() => { setSheetContent("copyWeek"); }}
                        className="w-full text-left p-3.5 rounded-xl hover:bg-gray-50 border border-gray-200 text-sm font-medium text-gray-900">
                        📋 Copy Last Week
                      </button>
                      <button onClick={() => {
                        closeSheet();
                        // Show employee picker for employee view
                        setViewMode("employee");
                        if (employees.length > 0) setSelectedEmployeeView(employees[0].id);
                      }}
                        className="w-full text-left p-3.5 rounded-xl hover:bg-gray-50 border border-gray-200 text-sm font-medium text-gray-900">
                        👤 View by Employee
                      </button>
                      <button onClick={() => { setSheetContent("pending"); }}
                        className="w-full text-left p-3.5 rounded-xl hover:bg-gray-50 border border-gray-200 text-sm font-medium text-gray-900">
                        ⏳ Pending Responses
                        {pendingCount > 0 && (
                          <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{pendingCount}</span>
                        )}
                      </button>
                    </div>
                  </>
                )}

                {/* ── COPY LAST WEEK ── */}
                {sheetContent === "copyWeek" && (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-bold text-gray-900">Copy Last Week</h2>
                      <button onClick={closeSheet} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
                    </div>

                    <div className="bg-gray-50 rounded-xl p-4 mb-4 text-sm space-y-2">
                      <div>
                        <span className="text-gray-500">From:</span>{" "}
                        <span className="font-medium">{(() => {
                          const prev = new Date(weekStart);
                          prev.setDate(prev.getDate() - 7);
                          const prevEnd = new Date(prev);
                          prevEnd.setDate(prevEnd.getDate() + 6);
                          return `${formatShortDate(prev)} – ${formatShortDate(prevEnd)}`;
                        })()}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">To:</span>{" "}
                        <span className="font-medium">{formatShortDate(weekDates[0])} – {formatShortDate(weekDates[6])}</span>
                      </div>
                    </div>

                    {copyError && (
                      <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">{copyError}</div>
                    )}

                    <button onClick={handleCopyWeekPreview} disabled={copyLoading}
                      className="w-full bg-blue-600 text-white rounded-xl py-3.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                      {copyLoading ? "Checking…" : "Preview"}
                    </button>
                  </>
                )}

                {/* ── COPY PREVIEW ── */}
                {sheetContent === "copyPreview" && copyPreview && (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-bold text-gray-900">Copy Preview</h2>
                      <button onClick={closeSheet} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
                    </div>

                    <div className="bg-gray-50 rounded-xl p-4 mb-4 text-sm">
                      <div className="font-semibold text-gray-900 mb-1">{copyTotal} shifts</div>
                      <div className="flex gap-4">
                        <span className="text-green-600">✓ {copyReady} ready</span>
                        {copyIssues > 0 && <span className="text-amber-600">⚠ {copyIssues} need attention</span>}
                      </div>
                    </div>

                    {/* Show issues */}
                    {copyPreview.filter((p) => p.status !== "ready").length > 0 && (
                      <div className="mb-4 space-y-2">
                        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Issues</div>
                        {copyPreview.filter((p) => p.status !== "ready").map((p, i) => (
                          <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm">
                            <div className="font-medium text-gray-900">{p.employeeName}</div>
                            <div className="text-gray-600">{formatFullDate(p.date)} · {formatHHMM(p.startTime)} – {formatHHMM(p.endTime)}</div>
                            <div className="text-amber-700 text-xs mt-1">⚠ {p.reason}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {copySuccess && (
                      <div className="bg-green-50 text-green-700 text-sm rounded-lg p-3 border border-green-200 mb-4">✓ {copySuccess}</div>
                    )}
                    {copyError && (
                      <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">{copyError}</div>
                    )}

                    <div className="flex gap-3">
                      <button onClick={() => setSheetContent("copyWeek")}
                        className="flex-1 border border-gray-300 text-gray-700 rounded-xl py-3 text-sm font-medium hover:bg-gray-50">
                        Back
                      </button>
                      <button onClick={handleCopyWeekCreate} disabled={copyLoading || copyReady === 0}
                        className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                        {copyLoading ? "Copying…" : `Copy ${copyReady} Shifts`}
                      </button>
                    </div>
                  </>
                )}

                {/* ── FIND EMPLOYEE ── */}
                {sheetContent === "findEmployee" && (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-bold text-gray-900">Find Employee</h2>
                      <button onClick={closeSheet} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
                    </div>

                    <div className="text-sm text-gray-600 mb-3">
                      {formatFullDate(findDate)} · {formatHHMM(findStartTime)} – {formatHHMM(findEndTime)}
                    </div>

                    {findLoading ? (
                      <div className="text-center py-8 text-gray-500 text-sm">Finding available employees…</div>
                    ) : (
                      <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
                        {findResults.filter((e) => e.status === "available" || e.status === "partial").map((emp) => (
                          <button key={emp.id}
                            onClick={() => handleQuickAssign(emp.id)}
                            className="w-full text-left p-3 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="text-sm font-medium text-gray-900">{emp.full_name}</div>
                                <div className="text-xs text-gray-500">
                                  {emp.status === "available" ? "Available" : emp.reason}
                                  <span className="ml-2">{emp.weeklyHours}h this week</span>
                                </div>
                              </div>
                              <span className="text-xs font-medium text-blue-600">Assign ›</span>
                            </div>
                          </button>
                        ))}

                        {findResults.filter((e) => e.status === "unavailable" || e.status === "conflict").length > 0 && (
                          <>
                            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-3 pb-1">Not Available</div>
                            {findResults.filter((e) => e.status === "unavailable" || e.status === "conflict").map((emp) => (
                              <div key={emp.id} className="p-3 rounded-xl border border-gray-200 opacity-50 text-sm">
                                <div className="font-medium text-gray-900">{emp.full_name}</div>
                                <div className="text-xs text-red-600">{emp.reason}</div>
                              </div>
                            ))}
                          </>
                        )}
                      </div>
                    )}

                    {createError && (
                      <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mt-4">{createError}</div>
                    )}
                  </>
                )}

                {/* ── PENDING RESPONSES ── */}
                {sheetContent === "pending" && (
                  <>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-lg font-bold text-gray-900">Pending Responses</h2>
                      <button onClick={closeSheet} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
                    </div>

                    {(() => {
                      const pendingShifts = shifts.filter((s) => s.status === "pending" || s.status === "updated_pending");
                      if (pendingShifts.length === 0) {
                        return <p className="text-sm text-gray-500 text-center py-4">No pending responses.</p>;
                      }
                      return (
                        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
                          {pendingShifts.map((s) => {
                            const emp = employees.find((e) => e.id === s.employee_id);
                            return (
                              <button key={s.id} onClick={() => openShift(s)}
                                className="w-full text-left p-3 rounded-xl border border-gray-200 hover:border-blue-300 hover:bg-blue-50">
                                <div className="flex items-center justify-between">
                                  <div>
                                    <div className="text-sm font-medium text-gray-900">{emp?.full_name}</div>
                                    <div className="text-xs text-gray-600">
                                      {formatFullDate(s.date)} · {formatTime(s.scheduled_start)} – {formatTime(s.scheduled_finish)}
                                    </div>
                                  </div>
                                  <StatusBadge status={s.status} />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Employee View selector (when in employee view mode) */}
      {viewMode === "employee" && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 z-40 md:relative md:border-t-0 md:p-0 md:mb-4 md:mt-4">
          <select
            value={selectedEmployeeView || ""}
            onChange={(e) => setSelectedEmployeeView(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.full_name}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
