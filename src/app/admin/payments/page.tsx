"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";

interface Payment {
  id: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  total_hours: number;
  total_mileage: number;
  total_amount: number;
  status: string;
  payment_date: string | null;
  employee?: { full_name: string; employee_number: string } | null;
}

interface Employee {
  id: string;
  full_name: string;
  employee_number: string;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Create form
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/payments").then((r) => r.json()),
      fetch("/api/employees").then((r) => r.json()),
    ]).then(([payData, empData]) => {
      if (Array.isArray(payData)) setPayments(payData);
      if (Array.isArray(empData)) setEmployees(empData);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEmployee || !periodStart || !periodEnd) {
      setCreateError("All fields are required.");
      return;
    }

    setCreating(true);
    setCreateError("");

    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: selectedEmployee,
          period_start: periodStart,
          period_end: periodEnd,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setCreateError(data.error || "Failed to create payment.");
        setCreating(false);
        return;
      }

      // Add to list and close form
      const emp = employees.find((e) => e.id === selectedEmployee);
      setPayments((prev) => [{ ...data, employee: emp || null }, ...prev]);
      setShowCreate(false);
      setSelectedEmployee("");
      setPeriodStart("");
      setPeriodEnd("");
    } catch {
      setCreateError("Something went wrong.");
    }
    setCreating(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium
                     hover:bg-blue-700 transition-colors"
        >
          {showCreate ? "Cancel" : "+ Create Payment"}
        </button>
      </div>

      {/* Create Payment Form */}
      {showCreate && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <h2 className="font-semibold text-gray-900 mb-3">Create Payment</h2>
          <p className="text-xs text-gray-500 mb-4">
            Select an employee and date range. This will group all approved timesheets in that period into a payment.
          </p>

          {createError && (
            <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-3">
              {createError}
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
              <select
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select employee…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name} ({emp.employee_number})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Period Start</label>
                <input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Period End</label>
                <input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={creating}
              className="w-full bg-green-600 text-white rounded-lg py-2.5 text-sm font-medium
                         hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {creating ? "Creating…" : "Create Payment"}
            </button>
          </form>
        </div>
      )}

      {/* Payments list */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading payments…</div>
      ) : payments.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500">No payments yet. Create a payment from approved timesheets.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {payments.map((p) => (
            <Link
              key={p.id}
              href={`/admin/payments/${p.id}`}
              className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-medium text-gray-900">
                    {p.employee?.full_name || "Unknown"}
                  </span>
                  <span className="text-xs text-gray-400 ml-2">
                    {p.employee?.employee_number}
                  </span>
                </div>
                <StatusBadge status={p.status} />
              </div>
              <div className="flex items-center justify-between text-sm text-gray-500">
                <div>
                  {formatDate(p.period_start)} – {formatDate(p.period_end)}
                </div>
                <div className="font-bold text-gray-900">${p.total_amount.toFixed(2)}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
