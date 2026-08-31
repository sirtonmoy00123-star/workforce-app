"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface PhotoRecord {
  id: string;
  bucket: string;
  path: string;
  shiftId: string;
  shiftDate: string | null;
  type: "odometer_start" | "odometer_finish" | "task_proof" | "selfie" | "site_photo";
  createdAt: string;
  signedUrl: string | null;
}

interface PhotoData {
  photos: PhotoRecord[];
  totalPhotos: number;
  estimatedStorageMB: number;
  byAge: {
    last30Days: number;
    thirtyTo60Days: number;
    sixtyTo90Days: number;
    older90Days: number;
  };
  byType: {
    odometer: number;
    taskProof: number;
    selfie: number;
    sitePhoto: number;
  };
}

const TYPE_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  odometer_start: { label: "Start Odometer", emoji: "🚗", color: "bg-blue-100 text-blue-700" },
  odometer_finish: { label: "Finish Odometer", emoji: "🏁", color: "bg-green-100 text-green-700" },
  task_proof: { label: "Task Proof", emoji: "📷", color: "bg-purple-100 text-purple-700" },
  selfie: { label: "Check-in Selfie", emoji: "🤳", color: "bg-amber-100 text-amber-700" },
  site_photo: { label: "Site Photo", emoji: "🏢", color: "bg-teal-100 text-teal-700" },
};

export default function EmployeePhotosPage() {
  const [data, setData] = useState<PhotoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm] = useState<"selected" | "bulk" | null>(null);
  const [bulkDays, setBulkDays] = useState(90);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    loadPhotos();
  }, []);

  async function loadPhotos() {
    setLoading(true);
    try {
      const res = await fetch("/api/employee/photos");
      const d = await res.json();
      if (!d.error) setData(d);
    } catch { /* ignore */ }
    setLoading(false);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (!data) return;
    if (selected.size === data.photos.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.photos.map((p) => p.id)));
    }
  }

  async function handleDeleteSelected() {
    setDeleting(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/employee/photos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: Array.from(selected) }),
      });
      const d = await res.json();
      if (res.ok) {
        setMessage(d.message);
        setSelected(new Set());
        setShowConfirm(null);
        await loadPhotos();
      } else {
        setError(d.error || "Failed to delete.");
      }
    } catch {
      setError("Network error.");
    }
    setDeleting(false);
  }

  async function handleBulkDelete() {
    setDeleting(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/employee/photos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleteOlderThanDays: bulkDays }),
      });
      const d = await res.json();
      if (res.ok) {
        setMessage(d.message);
        setShowConfirm(null);
        await loadPhotos();
      } else {
        setError(d.error || "Failed to delete.");
      }
    } catch {
      setError("Network error.");
    }
    setDeleting(false);
  }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-[3px] border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">📸 My Photos</h1>
        <Link href="/employee/home" className="text-sm text-blue-600 hover:underline">
          ← Home
        </Link>
      </div>

      {message && (
        <div className="bg-green-50 text-green-700 text-sm rounded-xl p-3 border border-green-200 mb-4">
          ✓ {message}
        </div>
      )}
      {error && (
        <div className="bg-red-50 text-red-700 text-sm rounded-xl p-3 border border-red-200 mb-4">
          {error}
        </div>
      )}

      {/* Storage Overview */}
      {data && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
          <h2 className="font-semibold text-gray-900 mb-3">Storage Overview</h2>

          <div className="flex items-center gap-3 mb-4">
            <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center">
              <span className="text-2xl">💾</span>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{data.totalPhotos}</div>
              <div className="text-sm text-gray-500">
                photos · ~{data.estimatedStorageMB} MB estimated
              </div>
            </div>
          </div>

          {/* By type */}
          <div className="grid grid-cols-2 gap-2 mb-4">
            <StatCard emoji="🚗" label="Odometer" count={data.byType.odometer} />
            <StatCard emoji="📷" label="Task Proof" count={data.byType.taskProof} />
            <StatCard emoji="🤳" label="Selfies" count={data.byType.selfie} />
            <StatCard emoji="🏢" label="Site Photos" count={data.byType.sitePhoto} />
          </div>

          {/* By age */}
          <h3 className="text-sm font-medium text-gray-700 mb-2">By Age</h3>
          <div className="space-y-1.5">
            <AgeRow label="Last 30 days" count={data.byAge.last30Days} color="text-green-600" />
            <AgeRow label="30–60 days" count={data.byAge.thirtyTo60Days} color="text-blue-600" />
            <AgeRow label="60–90 days" count={data.byAge.sixtyTo90Days} color="text-amber-600" />
            <AgeRow label="Older than 90 days" count={data.byAge.older90Days} color="text-red-600" />
          </div>
        </div>
      )}

      {/* Bulk Delete */}
      {data && data.totalPhotos > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
          <h2 className="font-semibold text-gray-900 mb-2">🧹 Clean Up Old Photos</h2>
          <p className="text-sm text-gray-500 mb-4">
            Delete all photos from completed shifts older than a set number of days.
            Only photos from completed shifts are deleted — active/pending shifts are safe.
          </p>

          <div className="flex gap-2 mb-3">
            {[30, 60, 90, 180].map((days) => (
              <button
                key={days}
                onClick={() => setBulkDays(days)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                  bulkDays === days
                    ? "bg-red-600 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {days}d
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowConfirm("bulk")}
            className="w-full bg-red-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-red-700 transition-colors"
          >
            Delete Photos Older Than {bulkDays} Days
          </button>
        </div>
      )}

      {/* Photo Gallery */}
      {data && data.photos.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Recent Photos</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={selectAll}
                className="text-xs text-blue-600 hover:underline"
              >
                {selected.size === data.photos.length ? "Deselect All" : "Select All"}
              </button>
              {selected.size > 0 && (
                <button
                  onClick={() => setShowConfirm("selected")}
                  className="bg-red-600 text-white px-3 py-1 rounded-lg text-xs font-medium"
                >
                  Delete {selected.size}
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {data.photos.map((photo) => {
              const typeInfo = TYPE_LABELS[photo.type] || { label: photo.type, emoji: "📎", color: "bg-gray-100 text-gray-700" };
              const isSelected = selected.has(photo.id);

              return (
                <div
                  key={photo.id}
                  onClick={() => toggleSelect(photo.id)}
                  className={`relative rounded-xl overflow-hidden border-2 cursor-pointer transition-all ${
                    isSelected ? "border-red-500 ring-2 ring-red-200" : "border-gray-200"
                  }`}
                >
                  {photo.signedUrl ? (
                    <img
                      src={photo.signedUrl}
                      alt={typeInfo.label}
                      className="w-full h-24 object-cover"
                    />
                  ) : (
                    <div className="w-full h-24 bg-gray-100 flex items-center justify-center text-2xl">
                      {typeInfo.emoji}
                    </div>
                  )}

                  {/* Checkbox overlay */}
                  <div className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    isSelected
                      ? "bg-red-500 border-red-500 text-white"
                      : "bg-white/80 border-gray-300"
                  }`}>
                    {isSelected && (
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>

                  {/* Type badge */}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1.5 py-0.5">
                    <span className="text-[10px] text-white font-medium">{typeInfo.emoji} {photo.shiftDate || ""}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {data.totalPhotos > data.photos.length && (
            <p className="text-xs text-gray-400 text-center mt-3">
              Showing {data.photos.length} of {data.totalPhotos} photos.
              Use bulk delete to clean up older photos.
            </p>
          )}
        </div>
      )}

      {data && data.totalPhotos === 0 && (
        <div className="text-center py-12 bg-white rounded-2xl border border-gray-200">
          <div className="text-3xl mb-2">✨</div>
          <p className="text-gray-500 text-sm">No photos stored yet.</p>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5">
            <h3 className="font-bold text-gray-900 text-lg mb-2">⚠️ Confirm Deletion</h3>
            <p className="text-sm text-gray-500 mb-4">
              {showConfirm === "selected"
                ? `Delete ${selected.size} selected photo${selected.size !== 1 ? "s" : ""}? This cannot be undone.`
                : `Delete all photos from completed shifts older than ${bulkDays} days? This cannot be undone.`}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(null)}
                disabled={deleting}
                className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-xl font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={showConfirm === "selected" ? handleDeleteSelected : handleBulkDelete}
                disabled={deleting}
                className="flex-1 bg-red-600 text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Yes, Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-components
function StatCard({ emoji, label, count }: { emoji: string; label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-xl border border-gray-100 bg-gray-50">
      <span className="text-lg">{emoji}</span>
      <div>
        <div className="text-sm font-semibold text-gray-900">{count}</div>
        <div className="text-[11px] text-gray-500">{label}</div>
      </div>
    </div>
  );
}

function AgeRow({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-gray-600">{label}</span>
      <span className={`text-sm font-semibold ${color}`}>{count}</span>
    </div>
  );
}
