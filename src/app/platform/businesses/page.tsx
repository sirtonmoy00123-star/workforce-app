"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Business {
  id: string;
  business_name: string;
  slug: string;
  email: string | null;
  status: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
  member_count: number;
  owner_username: string | null;
  created_at: string;
}

export default function BusinessesListPage() {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBusinesses();
  }, []);

  async function loadBusinesses() {
    setLoading(true);
    const res = await fetch("/api/platform/businesses");
    const data = await res.json();
    if (Array.isArray(data)) {
      setBusinesses(data);
    }
    setLoading(false);
  }

  async function toggleStatus(id: string, currentStatus: string) {
    const action = currentStatus === "ACTIVE" ? "suspend" : "activate";
    const confirmed = confirm(
      action === "suspend"
        ? "Suspend this business? Its users won't be able to log in."
        : "Reactivate this business?"
    );
    if (!confirmed) return;

    await fetch(`/api/platform/businesses/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    loadBusinesses();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-gray-500">Loading businesses…</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">All Businesses</h1>
        <Link
          href="/platform/businesses/new"
          className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium
                     hover:bg-emerald-700 transition-colors"
        >
          + Add Business
        </Link>
      </div>

      {businesses.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <p className="text-gray-500 mb-4">No businesses yet.</p>
          <Link
            href="/platform/businesses/new"
            className="text-emerald-600 font-medium hover:underline"
          >
            Create the first business →
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {businesses.map((biz) => (
            <div
              key={biz.id}
              className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/platform/businesses/${biz.id}`}
                    className="font-semibold text-gray-900 hover:text-blue-600 truncate"
                  >
                    {biz.business_name}
                  </Link>
                  <StatusBadge status={biz.status} />
                </div>
                <div className="text-sm text-gray-500 mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  <span>Slug: <code className="text-gray-700">{biz.slug}</code></span>
                  <span>{biz.member_count} member{biz.member_count !== 1 ? "s" : ""}</span>
                  {biz.owner_username && <span>Owner: {biz.owner_username}</span>}
                  <span>Created: {new Date(biz.created_at).toLocaleDateString()}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Link
                  href={`/platform/businesses/${biz.id}`}
                  className="text-sm text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg hover:bg-blue-50"
                >
                  View
                </Link>
                <button
                  onClick={() => toggleStatus(biz.id, biz.status)}
                  className={`text-sm px-3 py-1.5 rounded-lg ${
                    biz.status === "ACTIVE"
                      ? "text-red-600 hover:bg-red-50"
                      : "text-green-600 hover:bg-green-50"
                  }`}
                >
                  {biz.status === "ACTIVE" ? "Suspend" : "Activate"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
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
