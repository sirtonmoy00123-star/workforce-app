"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Settings {
  shiftReminderMinutes: number[];
  missingCheckinEmployeeMinutes: number;
  missingCheckinAdminMinutes: number;
  missingCheckoutEmployeeMinutes: number;
  missingCheckoutAdminMinutes: number;
  autoMarkAbsent: boolean;
  defaultOfferExpiryHours: number;
}

const REMINDER_OPTIONS = [
  { value: 1440, label: "24 hours before" },
  { value: 720, label: "12 hours before" },
  { value: 120, label: "2 hours before" },
  { value: 60, label: "1 hour before" },
  { value: 30, label: "30 minutes before" },
  { value: 15, label: "15 minutes before" },
];

export default function NotificationSettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/notification-settings")
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setSettings(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const res = await fetch("/api/admin/notification-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage("Settings saved successfully.");
        if (data.settings) setSettings(data.settings);
      } else {
        setError(data.error || "Failed to save.");
      }
    } catch {
      setError("Network error.");
    }
    setSaving(false);
  }

  function toggleReminder(minutes: number) {
    if (!settings) return;
    const current = settings.shiftReminderMinutes;
    if (current.includes(minutes)) {
      setSettings({ ...settings, shiftReminderMinutes: current.filter((m) => m !== minutes) });
    } else {
      setSettings({ ...settings, shiftReminderMinutes: [...current, minutes].sort((a, b) => b - a) });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-[3px] border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!settings) {
    return <div className="text-center py-12 text-gray-500">Could not load settings.</div>;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">🔔 Notification Settings</h1>
        <Link href="/admin/dashboard" className="text-sm text-blue-600 hover:underline">
          ← Dashboard
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

      {/* Shift Reminders */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
        <h2 className="font-semibold text-gray-900 mb-1">⏰ Shift Reminders</h2>
        <p className="text-sm text-gray-500 mb-4">
          Employees receive a reminder notification before their shift starts.
        </p>
        <div className="space-y-2">
          {REMINDER_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={settings.shiftReminderMinutes.includes(opt.value)}
                onChange={() => toggleReminder(opt.value)}
                className="w-4 h-4 text-blue-600 rounded border-gray-300"
              />
              <span className="text-sm text-gray-700">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Missing Check-In */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
        <h2 className="font-semibold text-gray-900 mb-1">📍 Missing Check-In Alerts</h2>
        <p className="text-sm text-gray-500 mb-4">
          Alert when an employee doesn&apos;t check in after their shift starts.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1.5">
              Employee reminder after
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={120}
                value={settings.missingCheckinEmployeeMinutes}
                onChange={(e) =>
                  setSettings({ ...settings, missingCheckinEmployeeMinutes: parseInt(e.target.value) || 5 })
                }
                className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-500">minutes</span>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1.5">
              Admin alert after
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={120}
                value={settings.missingCheckinAdminMinutes}
                onChange={(e) =>
                  setSettings({ ...settings, missingCheckinAdminMinutes: parseInt(e.target.value) || 15 })
                }
                className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-500">minutes</span>
            </div>
          </div>
        </div>
      </div>

      {/* Missing Checkout */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
        <h2 className="font-semibold text-gray-900 mb-1">🚪 Missing Checkout Alerts</h2>
        <p className="text-sm text-gray-500 mb-4">
          Alert when an employee doesn&apos;t check out after their shift ends.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1.5">
              Employee reminder after
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={120}
                value={settings.missingCheckoutEmployeeMinutes}
                onChange={(e) =>
                  setSettings({ ...settings, missingCheckoutEmployeeMinutes: parseInt(e.target.value) || 15 })
                }
                className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-500">minutes</span>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 block mb-1.5">
              Admin alert after
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={120}
                value={settings.missingCheckoutAdminMinutes}
                onChange={(e) =>
                  setSettings({ ...settings, missingCheckoutAdminMinutes: parseInt(e.target.value) || 30 })
                }
                className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-500">minutes</span>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-gray-100">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoMarkAbsent}
              onChange={(e) => setSettings({ ...settings, autoMarkAbsent: e.target.checked })}
              className="w-4 h-4 text-blue-600 rounded border-gray-300"
            />
            <div>
              <div className="text-sm font-medium text-gray-700">Auto-mark absent</div>
              <div className="text-xs text-gray-400">
                Automatically mark employees absent if they don&apos;t check in. ⚠️ Use with caution.
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Offer Expiry */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
        <h2 className="font-semibold text-gray-900 mb-1">🎪 Open Shift Offers</h2>
        <p className="text-sm text-gray-500 mb-4">
          Default expiry time for open shift offers sent to employees.
        </p>
        <div>
          <label className="text-xs font-medium text-gray-500 block mb-1.5">
            Default offer expiry
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={168}
              value={settings.defaultOfferExpiryHours}
              onChange={(e) =>
                setSettings({ ...settings, defaultOfferExpiryHours: parseInt(e.target.value) || 0 })
              }
              className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-500">hours (0 = no expiry)</span>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={saving}
        className="w-full bg-blue-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save Settings"}
      </button>
    </div>
  );
}
