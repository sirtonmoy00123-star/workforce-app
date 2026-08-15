"use client";

import { useEffect, useState } from "react";
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
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/employees")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setEmployees(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
        <Link
          href="/admin/employees/new"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium
                     hover:bg-blue-700 transition-colors"
        >
          + Add Employee
        </Link>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="text-center py-12 text-gray-500">Loading employees…</div>
      )}

      {/* Empty state */}
      {!loading && employees.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500 mb-4">No employees yet.</p>
          <Link
            href="/admin/employees/new"
            className="text-blue-600 font-medium hover:underline"
          >
            Add your first employee →
          </Link>
        </div>
      )}

      {/* Employee list — cards on mobile, table on desktop */}
      {!loading && employees.length > 0 && (
        <>
          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Phone</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Employee ID</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Hourly Rate</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Mileage Rate</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {employees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{emp.full_name}</td>
                      <td className="px-4 py-3 text-gray-600">{emp.phone || "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{emp.employee_number}</td>
                      <td className="px-4 py-3 text-gray-600">${emp.hourly_rate}/hr</td>
                      <td className="px-4 py-3 text-gray-600">${emp.mileage_rate}/km</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={emp.employment_status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/employees/${emp.id}`}
                          className="text-blue-600 hover:underline text-sm"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {employees.map((emp) => (
              <Link
                key={emp.id}
                href={`/admin/employees/${emp.id}`}
                className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900">{emp.full_name}</span>
                  <StatusBadge status={emp.employment_status} />
                </div>
                <div className="text-sm text-gray-500 space-y-0.5">
                  <div>ID: {emp.employee_number}</div>
                  <div>${emp.hourly_rate}/hr · ${emp.mileage_rate}/km</div>
                  {emp.phone && <div>{emp.phone}</div>}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
