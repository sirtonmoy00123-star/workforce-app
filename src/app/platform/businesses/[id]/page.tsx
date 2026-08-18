"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface BusinessDetail {
  id: string;
  business_name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  created_at: string;
  updated_at: string;
  members: Array<{
    id: string;
    role: string;
    status: string;
    created_at: string;
    users: { id: string; username: string; account_status: string };
  }>;
  employee_count: number;
  shift_count: number;
}

export default function BusinessDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [business, setBusiness] = useState<BusinessDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    loadBusiness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function loadBusiness() {
    setLoading(true);
    const res = await fetch(`/api/platform/businesses/${id}`);
    const data = await res.json();
    if (data.id) {
      setBusiness(data);
    }
    setLoading(false);
  }

  async function toggleStatus() {
    if (!business) return;
    const action = business.status === "ACTIVE" ? "suspend" : "activate";
    const confirmed = confirm(
      action === "suspend"
        ? "Suspend this business? All its users will be unable to access the app."
        : "Reactivate this business?"
    );
    if (!confirmed) return;

    setActionLoading(true);
    await fetch(`/api/platform/businesses/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await loadBusiness();
    setActionLoading(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-500">Loading business…</div>
      </div>
    );
  }

  if (!business) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Business not found.</p>
        <Link href="/platform/businesses" className="text-blue-600 hover:underline mt-2 inline-block">
          ← Back to Businesses
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link href="/platform/businesses" className="text-sm text-gray-500 hover:text-gray-700">
        ← Back to Businesses
      </Link>

      <div className="flex items-start justify-between mt-3 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{business.business_name}</h1>
            <StatusBadge status={business.status} />
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Slug: <code className="text-gray-700">{business.slug}</code> · Created {new Date(business.created_at).toLocaleDateString()}
          </p>
        </div>
        <button
          onClick={toggleStatus}
          disabled={actionLoading}
          className={`px-4 py-2 text-sm rounded-lg font-medium disabled:opacity-50 ${
            business.status === "ACTIVE"
              ? "bg-red-50 text-red-700 hover:bg-red-100"
              : "bg-green-50 text-green-700 hover:bg-green-100"
          }`}
        >
          {business.status === "ACTIVE" ? "Suspend Business" : "Activate Business"}
        </button>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <InfoCard label="Members" value={String(business.members.length)} />
        <InfoCard label="Employees" value={String(business.employee_count)} />
        <InfoCard label="Shifts" value={String(business.shift_count)} />
        <InfoCard label="Timezone" value={business.timezone} />
      </div>

      {/* Business details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Business Info</h2>
          <dl className="space-y-2 text-sm">
            <DetailRow label="Email" value={business.email || "—"} />
            <DetailRow label="Phone" value={business.phone || "—"} />
            <DetailRow label="Address" value={business.address || "—"} />
            <DetailRow label="Currency" value={business.currency} />
          </dl>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Members</h2>
          {business.members.length === 0 ? (
            <p className="text-sm text-gray-500">No members found.</p>
          ) : (
            <div className="space-y-2">
              {business.members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between text-sm py-1.5 border-b border-gray-100 last:border-0"
                >
                  <div>
                    <span className="text-gray-900">{member.users.username}</span>
                    <span className={`ml-2 text-xs font-medium px-1.5 py-0.5 rounded ${
                      member.role === "OWNER"
                        ? "bg-purple-100 text-purple-700"
                        : member.role === "ADMIN"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-600"
                    }`}>
                      {member.role}
                    </span>
                  </div>
                  <span className={`text-xs ${
                    member.users.account_status === "active" ? "text-green-600" : "text-red-600"
                  }`}>
                    {member.users.account_status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ACTIVE: "bg-green-100 text-green-700",
    SUSPENDED: "bg-red-100 text-red-700",
    ARCHIVED: "bg-gray-100 text-gray-600",
  };

  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${styles[status] || "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 text-right">{value}</dd>
    </div>
  );
}
