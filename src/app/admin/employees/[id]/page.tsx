"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";

interface Employee {
  id: string;
  full_name: string;
  phone: string | null;
  employee_number: string;
  hourly_rate: number;
  mileage_rate: number;
  employment_status: string;
  employment_type: "PERMANENT" | "PART_TIME" | "CASUAL";
  open_to_extra_shifts: boolean;
  odometer_tracking_enabled: boolean;
  task_proof_enabled: boolean;
  userRecord?: {
    id: string;
    username: string;
    account_status: string;
    must_change_password: boolean;
  };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface DayAvailability {
  dayOfWeek: number;
  isAvailable: boolean;
  startTime: string;
  endTime: string;
}

function defaultAvailability(): DayAvailability[] {
  return DAY_NAMES.map((_, i) => ({
    dayOfWeek: i,
    isAvailable: false,
    startTime: "09:00",
    endTime: "17:00",
  }));
}

export default function EmployeeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [tab, setTab] = useState<"details" | "availability" | "attendance">("details");
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Edit form state
  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    hourlyRate: "",
    mileageRate: "",
    employmentType: "PERMANENT" as string,
    openToExtraShifts: false,
    odometerTrackingEnabled: true,
    taskProofEnabled: false,
  });

  // Reset password state
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  // Availability state
  const [availability, setAvailability] = useState<DayAvailability[]>(defaultAvailability());
  const [loadingAvail, setLoadingAvail] = useState(false);
  const [savingAvail, setSavingAvail] = useState(false);

  // Attendance state
  interface AttendanceSummary {
    scheduled: number; present: number; late: number; absent: number;
    earlyDepartures: number; lateFinishes: number; needsReview: number;
    totalLateMinutes: number; approvedExtraMinutes: number; attendanceRate: number;
  }
  interface AttendanceDailyRecord {
    shift_id: string; date: string; scheduled_start: string; scheduled_finish: string;
    location: string | null; checkin_time: string | null; checkout_time: string | null;
    checkin_status: string; checkout_status: string; verification_status: string;
    exceptions: { type: string; minutes: number | null; status: string }[];
  }
  const [attSummary, setAttSummary] = useState<AttendanceSummary | null>(null);
  const [attRecords, setAttRecords] = useState<AttendanceDailyRecord[]>([]);
  const [loadingAtt, setLoadingAtt] = useState(false);

  useEffect(() => {
    fetch(`/api/employees/${id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setEmployee(data);
          setForm({
            fullName: data.full_name,
            phone: data.phone || "",
            hourlyRate: String(data.hourly_rate),
            mileageRate: String(data.mileage_rate),
            employmentType: data.employment_type || "PERMANENT",
            openToExtraShifts: data.open_to_extra_shifts || false,
            odometerTrackingEnabled: data.odometer_tracking_enabled !== false,
            taskProofEnabled: data.task_proof_enabled || false,
          });
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load employee.");
        setLoading(false);
      });
  }, [id]);

  // Load attendance when tab switches
  useEffect(() => {
    if (tab === "attendance") {
      setLoadingAtt(true);
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, "0");
      const firstDay = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const endDate = `${lastDay.getFullYear()}-${pad(lastDay.getMonth() + 1)}-${pad(lastDay.getDate())}`;

      fetch(`/api/attendance/reports?startDate=${firstDay}&endDate=${endDate}&employeeId=${id}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.summary) setAttSummary(data.summary);
          if (data.records) setAttRecords(data.records);
          setLoadingAtt(false);
        })
        .catch(() => setLoadingAtt(false));
    }
  }, [tab, id]);

  // Load availability when tab switches
  useEffect(() => {
    if (tab === "availability") {
      setLoadingAvail(true);
      fetch(`/api/employees/${id}/availability`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data) && data.length > 0) {
            const mapped = defaultAvailability();
            data.forEach((row: { day_of_week: number; is_available: boolean; start_time: string | null; end_time: string | null }) => {
              mapped[row.day_of_week] = {
                dayOfWeek: row.day_of_week,
                isAvailable: row.is_available,
                startTime: row.start_time || "09:00",
                endTime: row.end_time || "17:00",
              };
            });
            setAvailability(mapped);
          } else {
            setAvailability(defaultAvailability());
          }
          setLoadingAvail(false);
        })
        .catch(() => setLoadingAvail(false));
    }
  }, [tab, id]);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/employees/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to update.");
      } else {
        setEmployee((prev) =>
          prev
            ? {
                ...prev,
                full_name: data.full_name,
                phone: data.phone,
                hourly_rate: data.hourly_rate,
                mileage_rate: data.mileage_rate,
                employment_type: data.employment_type,
                open_to_extra_shifts: data.open_to_extra_shifts,
                odometer_tracking_enabled: data.odometer_tracking_enabled,
                task_proof_enabled: data.task_proof_enabled,
              }
            : prev
        );
        setEditing(false);
        setMessage("Employee updated successfully.");
        setTimeout(() => setMessage(""), 3000);
      }
    } catch {
      setError("Something went wrong.");
    }
    setSaving(false);
  }

  async function handleAction(action: string) {
    setError("");
    setMessage("");
    const body: Record<string, string> = { action };
    if (action === "reset-password") {
      if (!newPassword || newPassword.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }
      body.newPassword = newPassword;
    }

    try {
      const res = await fetch(`/api/employees/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
      } else {
        setMessage(data.message);
        setShowResetPassword(false);
        setNewPassword("");
        const refreshRes = await fetch(`/api/employees/${id}`);
        const refreshData = await refreshRes.json();
        if (!refreshData.error) setEmployee(refreshData);
      }
    } catch {
      setError("Something went wrong.");
    }
  }

  async function handleSaveAvailability() {
    setSavingAvail(true);
    setError("");
    try {
      const res = await fetch(`/api/employees/${id}/availability`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: availability }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save availability.");
      } else {
        setMessage("Availability saved successfully.");
        setTimeout(() => setMessage(""), 3000);
      }
    } catch {
      setError("Something went wrong.");
    }
    setSavingAvail(false);
  }

  function updateDay(dayIndex: number, field: string, value: string | boolean) {
    setAvailability((prev) =>
      prev.map((d, i) => (i === dayIndex ? { ...d, [field]: value } : d))
    );
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;
  if (!employee) return <div className="text-center py-12 text-red-500">{error || "Employee not found."}</div>;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Back link */}
      <button
        onClick={() => router.push("/admin/employees")}
        className="text-sm text-blue-600 hover:underline mb-4 inline-block"
      >
        ← Back to Employees
      </button>

      {/* Messages */}
      {message && (
        <div className="bg-green-50 text-green-700 text-sm rounded-lg p-3 border border-green-200 mb-4">
          {message}
        </div>
      )}
      {error && (
        <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">
          {error}
        </div>
      )}

      {/* Header with name */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-900">{employee.full_name}</h1>
        <div className="flex items-center gap-2">
          <StatusBadge status={employee.employment_status} />
          {employee.userRecord && (
            <StatusBadge status={employee.userRecord.account_status} />
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg">
        <button
          onClick={() => setTab("details")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === "details" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Details
        </button>
        <button
          onClick={() => setTab("availability")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === "availability" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Availability
        </button>
        <button
          onClick={() => setTab("attendance")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
            tab === "attendance" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Attendance
        </button>
      </div>

      {/* Details Tab */}
      {tab === "details" && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
            {editing ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Hourly Rate ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.hourlyRate}
                      onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                                 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Mileage Rate ($/km)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.mileageRate}
                      onChange={(e) => setForm({ ...form, mileageRate: e.target.value })}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                                 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                {/* Employment Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Employment Type</label>
                  <select
                    value={form.employmentType}
                    onChange={(e) => setForm({ ...form, employmentType: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="PERMANENT">Permanent</option>
                    <option value="PART_TIME">Part-Time</option>
                    <option value="CASUAL">Casual</option>
                  </select>
                </div>
                {/* Open to Extra Shifts */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.openToExtraShifts}
                    onChange={(e) => setForm({ ...form, openToExtraShifts: e.target.checked })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">Open to extra shifts</span>
                </label>

                {/* Shift Evidence Options */}
                <div className="border-t border-gray-200 pt-3 mt-1">
                  <div className="text-sm font-medium text-gray-700 mb-2">Shift Evidence Options</div>
                  <div className="space-y-2">
                    <label className="flex items-center justify-between p-3 rounded-lg border border-gray-200 cursor-pointer hover:border-gray-300 transition-colors">
                      <div>
                        <div className="text-sm font-medium text-gray-900">🚗 Odometer Tracking</div>
                        <div className="text-xs text-gray-500">Require odometer photos at shift start & end</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, odometerTrackingEnabled: !form.odometerTrackingEnabled })}
                        className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                          form.odometerTrackingEnabled ? "bg-blue-600" : "bg-gray-300"
                        }`}
                      >
                        <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform shadow-sm ${
                          form.odometerTrackingEnabled ? "translate-x-7" : "translate-x-1"
                        }`} />
                      </button>
                    </label>
                    <label className="flex items-center justify-between p-3 rounded-lg border border-gray-200 cursor-pointer hover:border-gray-300 transition-colors">
                      <div>
                        <div className="text-sm font-medium text-gray-900">📷 Task Proof Photos</div>
                        <div className="text-xs text-gray-500">Require task proof uploads (cleaning, etc.)</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, taskProofEnabled: !form.taskProofEnabled })}
                        className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                          form.taskProofEnabled ? "bg-blue-600" : "bg-gray-300"
                        }`}
                      >
                        <span className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform shadow-sm ${
                          form.taskProofEnabled ? "translate-x-7" : "translate-x-1"
                        }`} />
                      </button>
                    </label>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium
                               hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? "Saving…" : "Save Changes"}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm
                               hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-y-3">
                  <div>
                    <span className="text-gray-500">Employee ID</span>
                    <div className="font-medium">{employee.employee_number}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Phone</span>
                    <div className="font-medium">{employee.phone || "—"}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Hourly Rate</span>
                    <div className="font-medium">${employee.hourly_rate}/hr</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Mileage Rate</span>
                    <div className="font-medium">${employee.mileage_rate}/km</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Type</span>
                    <div className="font-medium capitalize">{(employee.employment_type || "PERMANENT").replace(/_/g, "-").toLowerCase()}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Extra Shifts</span>
                    <div className="font-medium">{employee.open_to_extra_shifts ? "✓ Open" : "—"}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Odometer Tracking</span>
                    <div className="font-medium">{employee.odometer_tracking_enabled ? "🚗 ON" : "OFF"}</div>
                  </div>
                  <div>
                    <span className="text-gray-500">Task Proof</span>
                    <div className="font-medium">{employee.task_proof_enabled ? "📷 ON" : "OFF"}</div>
                  </div>
                  {employee.userRecord && (
                    <div>
                      <span className="text-gray-500">Login User ID</span>
                      <div className="font-medium">{employee.userRecord.username}</div>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setEditing(true)}
                  className="mt-3 text-blue-600 text-sm font-medium hover:underline"
                >
                  Edit Details
                </button>
              </div>
            )}
          </div>

          {/* Actions Card */}
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Actions</h2>
            <div className="space-y-3">
              {employee.employment_status === "active" ? (
                <button
                  onClick={() => handleAction("disable")}
                  className="w-full text-left px-4 py-2.5 rounded-lg border border-red-200
                             text-red-700 text-sm hover:bg-red-50 transition-colors"
                >
                  Disable Employee
                </button>
              ) : (
                <button
                  onClick={() => handleAction("enable")}
                  className="w-full text-left px-4 py-2.5 rounded-lg border border-green-200
                             text-green-700 text-sm hover:bg-green-50 transition-colors"
                >
                  Reactivate Employee
                </button>
              )}

              {showResetPassword ? (
                <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                  <label className="block text-sm font-medium text-gray-700">
                    New Temporary Password
                  </label>
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAction("reset-password")}
                      className="bg-orange-600 text-white px-3 py-1.5 rounded-lg text-sm
                                 hover:bg-orange-700 transition-colors"
                    >
                      Reset Password
                    </button>
                    <button
                      onClick={() => {
                        setShowResetPassword(false);
                        setNewPassword("");
                      }}
                      className="text-sm text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowResetPassword(true)}
                  className="w-full text-left px-4 py-2.5 rounded-lg border border-orange-200
                             text-orange-700 text-sm hover:bg-orange-50 transition-colors"
                >
                  Reset Password
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Attendance Tab */}
      {tab === "attendance" && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Attendance</h2>
              <p className="text-xs text-gray-400">
                {new Date().toLocaleDateString("en-AU", { month: "long", year: "numeric" })}
              </p>
            </div>
            <Link
              href={`/admin/attendance/reports?employeeId=${id}`}
              className="text-xs text-blue-600 hover:underline"
            >
              Full Report →
            </Link>
          </div>

          {loadingAtt ? (
            <div className="text-center py-8 text-gray-500">Loading…</div>
          ) : attSummary ? (
            <div className="space-y-4">
              {/* Summary Grid */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex justify-between p-2 bg-gray-50 rounded-lg">
                  <span className="text-gray-500">Scheduled</span>
                  <span className="font-medium">{attSummary.scheduled}</span>
                </div>
                <div className="flex justify-between p-2 bg-green-50 rounded-lg">
                  <span className="text-green-700">Present</span>
                  <span className="font-medium text-green-700">{attSummary.present}</span>
                </div>
                <div className="flex justify-between p-2 bg-amber-50 rounded-lg">
                  <span className="text-amber-700">Late</span>
                  <span className="font-medium text-amber-700">{attSummary.late}</span>
                </div>
                <div className="flex justify-between p-2 bg-red-50 rounded-lg">
                  <span className="text-red-700">Absent</span>
                  <span className="font-medium text-red-700">{attSummary.absent}</span>
                </div>
                <div className="flex justify-between p-2 bg-amber-50 rounded-lg">
                  <span className="text-amber-700">Early Dep.</span>
                  <span className="font-medium text-amber-700">{attSummary.earlyDepartures}</span>
                </div>
                <div className="flex justify-between p-2 bg-orange-50 rounded-lg">
                  <span className="text-orange-700">Review</span>
                  <span className="font-medium text-orange-700">{attSummary.needsReview}</span>
                </div>
              </div>

              {/* Attendance Rate */}
              <div className="flex items-center justify-between py-2 border-t border-gray-100">
                <span className="text-sm text-gray-500">Attendance Rate</span>
                <span className={`text-lg font-bold ${
                  attSummary.attendanceRate >= 90 ? "text-green-600" :
                  attSummary.attendanceRate >= 75 ? "text-amber-600" : "text-red-600"
                }`}>
                  {attSummary.attendanceRate}%
                </span>
              </div>

              {attSummary.totalLateMinutes > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Total Late</span>
                  <span className="font-medium text-amber-600">
                    {Math.floor(attSummary.totalLateMinutes / 60) > 0
                      ? `${Math.floor(attSummary.totalLateMinutes / 60)}h ${attSummary.totalLateMinutes % 60}m`
                      : `${attSummary.totalLateMinutes}m`}
                  </span>
                </div>
              )}

              {attSummary.approvedExtraMinutes > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Approved Extra Time</span>
                  <span className="font-medium text-green-600">
                    {Math.floor(attSummary.approvedExtraMinutes / 60) > 0
                      ? `${Math.floor(attSummary.approvedExtraMinutes / 60)}h ${attSummary.approvedExtraMinutes % 60}m`
                      : `${attSummary.approvedExtraMinutes}m`}
                  </span>
                </div>
              )}

              {/* Daily Records */}
              {attRecords.length > 0 && (
                <div className="border-t border-gray-100 pt-3">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Daily History</h3>
                  <div className="space-y-2">
                    {attRecords.slice(0, 10).map((rec) => {
                      const dateStr = new Date(rec.date + "T00:00:00").toLocaleDateString("en-AU", {
                        weekday: "short", day: "numeric", month: "short",
                      });
                      const fmtTime = (iso: string) =>
                        new Date(iso).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });

                      return (
                        <div key={rec.shift_id} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                          <div>
                            <span className="text-sm font-medium text-gray-700">{dateStr}</span>
                            <div className="text-xs text-gray-400">
                              {rec.checkin_time ? `📥 ${fmtTime(rec.checkin_time)}` : "📥 —"}
                              {" · "}
                              {rec.checkout_time ? `📤 ${fmtTime(rec.checkout_time)}` : "📤 —"}
                            </div>
                          </div>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            rec.checkin_status === "PRESENT" || rec.checkin_status === "APPROVED_MANUALLY" ? "text-green-700 bg-green-50" :
                            rec.checkin_status === "LATE" ? "text-amber-700 bg-amber-50" :
                            rec.checkin_status === "NEEDS_REVIEW" ? "text-red-700 bg-red-50" :
                            "text-gray-500 bg-gray-50"
                          }`}>
                            {rec.checkin_status === "PRESENT" || rec.checkin_status === "APPROVED_MANUALLY" ? "✓" :
                             rec.checkin_status === "LATE" ? "⚠ Late" :
                             rec.checkin_status === "NEEDS_REVIEW" ? "⚠ Review" : "○"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">No attendance data this month.</div>
          )}
        </div>
      )}

      {/* Availability Tab */}
      {tab === "availability" && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Weekly Availability</h2>
          <p className="text-xs text-gray-400 mb-4">
            Set when this employee is available for shifts each week.
          </p>

          {loadingAvail ? (
            <div className="text-center py-8 text-gray-500">Loading…</div>
          ) : (
            <div className="space-y-3">
              {availability.map((day, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    day.isAvailable
                      ? "border-blue-200 bg-blue-50/50"
                      : "border-gray-100 bg-gray-50/50"
                  }`}
                >
                  {/* Day name */}
                  <div className="w-24 shrink-0">
                    <span className="text-sm font-medium text-gray-700">
                      {DAY_NAMES[i]}
                    </span>
                  </div>

                  {/* Toggle */}
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={day.isAvailable}
                      onChange={(e) => updateDay(i, "isAvailable", e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-300 peer-checked:bg-blue-600 rounded-full
                                    peer-focus:ring-2 peer-focus:ring-blue-300 transition-colors
                                    after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                                    after:bg-white after:rounded-full after:h-4 after:w-4
                                    after:transition-all peer-checked:after:translate-x-full" />
                  </label>

                  {/* Time inputs — only show when available */}
                  {day.isAvailable ? (
                    <div className="flex items-center gap-2 text-sm">
                      <input
                        type="time"
                        value={day.startTime}
                        onChange={(e) => updateDay(i, "startTime", e.target.value)}
                        className="rounded border border-gray-300 px-2 py-1 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <span className="text-gray-400">to</span>
                      <input
                        type="time"
                        value={day.endTime}
                        onChange={(e) => updateDay(i, "endTime", e.target.value)}
                        className="rounded border border-gray-300 px-2 py-1 text-sm
                                   focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  ) : (
                    <span className="text-sm text-gray-400">Unavailable</span>
                  )}
                </div>
              ))}

              <button
                onClick={handleSaveAvailability}
                disabled={savingAvail}
                className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium
                           hover:bg-blue-700 disabled:opacity-50 transition-colors mt-4"
              >
                {savingAvail ? "Saving…" : "Save Availability"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
