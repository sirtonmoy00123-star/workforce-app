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
  status: string;
}

interface Employee {
  id: string;
  full_name: string;
  employee_number: string;
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function formatDate(d: Date): string {
  // Use local date parts, not UTC (toISOString shifts dates for non-UTC zones)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true });
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function RosterPage() {
  const [weekStart, setWeekStart] = useState<Date>(getMonday(new Date()));
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  // Compute the 7 dates for the week
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
                                <div key={s.id} className="mb-1">
                                  <div className="text-xs font-medium">
                                    {formatTime(s.scheduled_start)}–{formatTime(s.scheduled_finish)}
                                  </div>
                                  <StatusBadge status={s.status} />
                                </div>
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
                          <div
                            key={s.id}
                            className="flex items-center justify-between text-sm border-l-2 border-blue-400 pl-3"
                          >
                            <div>
                              <div className="font-medium">{emp?.full_name}</div>
                              <div className="text-gray-500">
                                {formatTime(s.scheduled_start)}–{formatTime(s.scheduled_finish)}
                                {s.location && ` · ${s.location}`}
                              </div>
                            </div>
                            <StatusBadge status={s.status} />
                          </div>
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
    </div>
  );
}
