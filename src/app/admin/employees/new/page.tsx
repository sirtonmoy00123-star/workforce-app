"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewEmployeePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{
    userId: string;
    temporaryPassword: string;
  } | null>(null);

  const [form, setForm] = useState({
    fullName: "",
    phone: "",
    employeeNumber: "",
    hourlyRate: "",
    mileageRate: "",
    userId: "",
    temporaryPassword: "",
    odometerTrackingEnabled: true,
    taskProofEnabled: false,
  });

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create employee.");
        setLoading(false);
        return;
      }

      setSuccess({
        userId: form.userId,
        temporaryPassword: form.temporaryPassword,
      });
      setLoading(false);
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  // Show success message with login credentials
  if (success) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-green-50 border border-green-200 rounded-xl p-6">
          <h2 className="text-lg font-bold text-green-800 mb-2">
            ✅ Employee Created Successfully
          </h2>
          <p className="text-green-700 text-sm mb-4">
            Share these login credentials with the employee:
          </p>
          <div className="bg-white rounded-lg p-4 border border-green-200 space-y-2 text-sm">
            <div>
              <span className="text-gray-500">User ID:</span>{" "}
              <span className="font-mono font-medium">{success.userId}</span>
            </div>
            <div>
              <span className="text-gray-500">Temporary Password:</span>{" "}
              <span className="font-mono font-medium">{success.temporaryPassword}</span>
            </div>
          </div>
          <p className="text-xs text-green-600 mt-3">
            The employee will be asked to create a new password on first login.
          </p>
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => router.push("/admin/employees")}
              className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium
                         hover:bg-green-700 transition-colors"
            >
              View All Employees
            </button>
            <button
              onClick={() => {
                setSuccess(null);
                setForm({
                  fullName: "",
                  phone: "",
                  employeeNumber: "",
                  hourlyRate: "",
                  mileageRate: "",
                  userId: "",
                  temporaryPassword: "",
                  odometerTrackingEnabled: true,
                  taskProofEnabled: false,
                });
              }}
              className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium
                         hover:bg-gray-50 transition-colors"
            >
              Add Another Employee
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Add Employee</h1>

      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-xl border border-gray-200 p-6 space-y-4"
      >
        {error && (
          <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Full Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.fullName}
            onChange={(e) => updateField("fullName", e.target.value)}
            required
            placeholder="e.g. John Smith"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Phone Number
          </label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => updateField("phone", e.target.value)}
            placeholder="e.g. 0412 345 678"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Employee ID <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.employeeNumber}
            onChange={(e) => updateField("employeeNumber", e.target.value)}
            required
            placeholder="e.g. EMP001"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Hourly Rate ($) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.hourlyRate}
              onChange={(e) => updateField("hourlyRate", e.target.value)}
              required
              placeholder="30.00"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Mileage Rate ($/km) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.mileageRate}
              onChange={(e) => updateField("mileageRate", e.target.value)}
              required
              placeholder="0.50"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Shift Evidence Options */}
        <div className="border-t border-gray-200 pt-4">
          <div className="text-sm font-medium text-gray-700 mb-2">Shift Evidence Options</div>
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200">
              <div>
                <div className="text-sm font-medium text-gray-900">🚗 Odometer Tracking</div>
                <div className="text-xs text-gray-500">Require odometer photos at shift start & end</div>
              </div>
              <button
                type="button"
                onClick={() => setForm({ ...form, odometerTrackingEnabled: !form.odometerTrackingEnabled })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  form.odometerTrackingEnabled ? "bg-blue-600" : "bg-gray-300"
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  form.odometerTrackingEnabled ? "translate-x-6" : "translate-x-1"
                }`} />
              </button>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200">
              <div>
                <div className="text-sm font-medium text-gray-900">📷 Task Proof Photos</div>
                <div className="text-xs text-gray-500">Require task proof uploads (cleaning, etc.)</div>
              </div>
              <button
                type="button"
                onClick={() => setForm({ ...form, taskProofEnabled: !form.taskProofEnabled })}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  form.taskProofEnabled ? "bg-blue-600" : "bg-gray-300"
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  form.taskProofEnabled ? "translate-x-6" : "translate-x-1"
                }`} />
              </button>
            </div>
          </div>
        </div>

        <hr className="border-gray-200" />

        <p className="text-xs text-gray-500">
          Login credentials — the employee will use these to sign in.
        </p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            User ID (Login) <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.userId}
            onChange={(e) => updateField("userId", e.target.value)}
            required
            placeholder="e.g. john.smith"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Temporary Password <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.temporaryPassword}
            onChange={(e) => updateField("temporaryPassword", e.target.value)}
            required
            minLength={6}
            placeholder="At least 6 characters"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <p className="text-xs text-gray-400 mt-1">
            Employee will be forced to change this on first login.
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium
                       hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Creating…" : "Create Employee"}
          </button>
          <button
            type="button"
            onClick={() => router.push("/admin/employees")}
            className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium
                       text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
