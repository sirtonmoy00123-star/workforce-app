"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import StatusBadge from "@/components/StatusBadge";

interface PaymentDetail {
  id: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  total_hours: number;
  total_mileage: number;
  wage_amount: number;
  mileage_amount: number;
  total_amount: number;
  status: string;
  payment_date: string | null;
  employee?: { full_name: string; employee_number: string } | null;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function AdminPaymentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [payment, setPayment] = useState<PaymentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetch(`/api/payments/${id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setPayment(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load payment.");
        setLoading(false);
      });
  }, [id]);

  async function handleMarkPaid() {
    setActing(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/payments/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_paid" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to mark as paid.");
      } else {
        setPayment((prev) => prev ? { ...prev, status: "paid" } : prev);
        setSuccess("Payment marked as paid!");
      }
    } catch {
      setError("Something went wrong.");
    }
    setActing(false);
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;
  if (!payment) return <div className="text-center py-12 text-red-500">{error || "Payment not found."}</div>;

  return (
    <div className="max-w-lg mx-auto">
      <button
        onClick={() => router.push("/admin/payments")}
        className="text-sm text-blue-600 hover:underline mb-4 inline-block"
      >
        ← Back to Payments
      </button>

      {success && (
        <div className="bg-green-50 text-green-700 text-sm rounded-lg p-3 border border-green-200 mb-4">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mb-4">
          {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Payment Details</h1>
            <p className="text-sm text-gray-500">
              {payment.employee?.full_name} ({payment.employee?.employee_number})
            </p>
          </div>
          <StatusBadge status={payment.status} />
        </div>

        <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Period</span>
            <span className="font-medium">
              {formatDate(payment.period_start)} – {formatDate(payment.period_end)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Total Hours</span>
            <span className="font-medium">{payment.total_hours}h</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Total Mileage</span>
            <span className="font-medium">{payment.total_mileage} km</span>
          </div>
          <hr className="my-1" />
          <div className="flex justify-between">
            <span className="text-gray-500">Wages</span>
            <span className="font-medium">${payment.wage_amount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Mileage</span>
            <span className="font-medium">${payment.mileage_amount.toFixed(2)}</span>
          </div>
          <hr className="my-1" />
          <div className="flex justify-between font-bold text-base">
            <span>Total</span>
            <span className="text-green-600">${payment.total_amount.toFixed(2)}</span>
          </div>
        </div>

        {payment.status === "unpaid" && (
          <button
            onClick={handleMarkPaid}
            disabled={acting}
            className="w-full bg-green-600 text-white rounded-lg py-3 text-sm font-bold
                       hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {acting ? "Processing…" : "💰 Mark as Paid"}
          </button>
        )}

        {payment.status === "paid" && (
          <p className="text-center text-sm text-green-600 font-medium">
            ✅ This payment has been marked as paid.
            {payment.payment_date && ` (${formatDate(payment.payment_date)})`}
          </p>
        )}
      </div>
    </div>
  );
}
