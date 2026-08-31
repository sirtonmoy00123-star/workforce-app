"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  action_url: string | null;
  is_read: boolean;
  created_at: string;
  employee_id: string | null;
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getTypeIcon(type: string): string {
  switch (type) {
    case "LATE_ARRIVAL": return "⏰";
    case "EARLY_DEPARTURE": return "🚪";
    case "LATE_DEPARTURE": return "🕐";
    case "GPS_OUTSIDE_RADIUS": return "📍";
    case "WRONG_SITE": return "🚫";
    case "MISSED_CHECKIN": return "❌";
    case "MISSING_CHECKOUT": return "🚪";
    case "CORRECTION_REQUEST": return "✏️";
    case "ATTENDANCE_NEEDS_REVIEW": return "⚠";
    case "SHIFT_ASSIGNED": return "📅";
    case "SHIFT_UPDATED": return "✏️";
    case "SHIFT_CANCELLED": return "❌";
    case "SHIFT_REMINDER": return "⏰";
    case "OPEN_SHIFT_AVAILABLE": return "🎪";
    case "TIMESHEET_APPROVED": return "✅";
    case "TIMESHEET_CORRECTION": return "✏️";
    case "PAYMENT_PROCESSED": return "💰";
    case "LEAVE_APPROVED": return "✅";
    case "LEAVE_REJECTED": return "❌";
    case "OFFER_RECEIVED": return "🎪";
    case "OFFER_EXPIRED": return "⏰";
    case "OFFER_ACCEPTED": return "✅";
    default: return "🔔";
  }
}

export default function AdminNotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/notifications?limit=50")
      .then((r) => r.json())
      .then((data) => {
        if (data.notifications) setNotifications(data.notifications);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function markAllRead() {
    await fetch("/api/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_all_read" }),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  }

  async function markRead(id: string) {
    await fetch("/api/notifications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_read", notificationIds: [id] }),
    });
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
  }

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-sm text-blue-600 hover:underline"
          >
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">🔔</div>
          <div className="text-gray-500">No notifications yet.</div>
          <p className="text-xs text-gray-400 mt-2">
            Notifications appear when attendance exceptions occur.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map((notif) => {
            const content = (
              <div
                className={`rounded-xl border p-4 transition-colors ${
                  notif.is_read
                    ? "bg-white border-gray-200"
                    : "bg-blue-50 border-blue-200"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-lg mt-0.5">{getTypeIcon(notif.type)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${notif.is_read ? "text-gray-700" : "text-gray-900"}`}>
                        {notif.title}
                      </span>
                      <span className="text-xs text-gray-400 whitespace-nowrap ml-2">
                        {timeAgo(notif.created_at)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{notif.message}</p>
                  </div>
                  {!notif.is_read && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        markRead(notif.id);
                      }}
                      className="text-xs text-blue-600 hover:underline whitespace-nowrap"
                    >
                      ✓
                    </button>
                  )}
                </div>
              </div>
            );

            if (notif.action_url) {
              return (
                <Link
                  key={notif.id}
                  href={notif.action_url}
                  onClick={() => {
                    if (!notif.is_read) markRead(notif.id);
                  }}
                >
                  {content}
                </Link>
              );
            }

            return <div key={notif.id}>{content}</div>;
          })}
        </div>
      )}
    </div>
  );
}
