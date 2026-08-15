"use client";

import { useEffect, useState } from "react";
import StatusBadge from "@/components/StatusBadge";

interface Payment {
  id: string;
  period_start: string;
  period_end: string;
  total_hours: number;
  total_mileage: number;
  wage_amount: number;
  mileage_amount: number;
  total_amount: number;
  status: string;
  payment_date: string | null;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export default function EmployeePaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/payments")
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setPayments(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading payments…</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Payments</h1>

      {payments.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500">No payments yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {payments.map((p) => (
            <div
              key={p.id}
              className="bg-white rounded-xl border border-gray-200 p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-gray-900">
                  {formatDate(p.period_start)} – {formatDate(p.period_end)}
                </span>
                <StatusBadge status={p.status} />
              </div>
              <div className="text-sm text-gray-500 space-y-1">
                <div>{p.total_hours}h worked · {p.total_mileage} km</div>
              </div>
              <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between items-center">
                <div className="text-sm text-gray-500">
                  <span>Wages ${p.wage_amount.toFixed(2)} + Mileage ${p.mileage_amount.toFixed(2)}</span>
                </div>
                <span className="font-bold text-lg text-gray-900">${p.total_amount.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
