"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface OfferData {
  recipient_id: string;
  offer_id: string;
  recipient_status: string;
  sent_at: string;
  responded_at: string | null;
  shift_id: string | null;
  offer: {
    role: string;
    positions_required: number;
    positions_filled: number;
    offer_status: string;
    expires_at: string | null;
  } | null;
  event: {
    id: string;
    name: string;
    event_date: string;
    location: string | null;
    start_time: string;
    finish_time: string;
    event_status: string;
  } | null;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function EmployeeOffersPage() {
  const [offers, setOffers] = useState<OfferData[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<Record<string, string>>({});

  useEffect(() => {
    loadOffers();
  }, []);

  function loadOffers() {
    fetch("/api/offers/my")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setOffers(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }

  async function handleRespond(recipientId: string, action: "accept" | "decline") {
    setRespondingId(recipientId);
    setResultMessage((prev) => ({ ...prev, [recipientId]: "" }));

    try {
      const res = await fetch(`/api/offers/${recipientId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();

      if (!res.ok) {
        setResultMessage((prev) => ({
          ...prev,
          [recipientId]: data.error || "Something went wrong.",
        }));
        setRespondingId(null);
        return;
      }

      if (action === "accept") {
        setResultMessage((prev) => ({
          ...prev,
          [recipientId]: data.fully_staffed
            ? "✅ Accepted! You got the last spot."
            : `✅ Accepted! (${data.positions_filled}/${data.positions_required} filled)`,
        }));
      } else {
        setResultMessage((prev) => ({
          ...prev,
          [recipientId]: "Declined.",
        }));
      }

      // Update local state
      setOffers((prev) =>
        prev.map((o) =>
          o.recipient_id === recipientId
            ? { ...o, recipient_status: action === "accept" ? "ACCEPTED" : "DECLINED" }
            : o
        )
      );
    } catch {
      setResultMessage((prev) => ({
        ...prev,
        [recipientId]: "Network error. Try again.",
      }));
    }
    setRespondingId(null);
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading offers…</div>;
  }

  const pendingOffers = offers.filter((o) => o.recipient_status === "PENDING");
  const pastOffers = offers.filter((o) => o.recipient_status !== "PENDING");

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-5">Open Shift Offers</h1>

      {offers.length === 0 && (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-gray-500 text-sm">No open shift offers right now.</p>
          <p className="text-gray-400 text-xs mt-1">
            When your admin sends you an extra shift opportunity, it will appear here.
          </p>
        </div>
      )}

      {/* Pending Offers */}
      {pendingOffers.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-3">
            🔔 New Offers ({pendingOffers.length})
          </h2>
          {pendingOffers.map((o) => (
            <OfferCard
              key={o.recipient_id}
              offer={o}
              isResponding={respondingId === o.recipient_id}
              message={resultMessage[o.recipient_id]}
              onAccept={() => handleRespond(o.recipient_id, "accept")}
              onDecline={() => handleRespond(o.recipient_id, "decline")}
            />
          ))}
        </div>
      )}

      {/* Past Offers */}
      {pastOffers.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Past Responses
          </h2>
          {pastOffers.map((o) => (
            <OfferCard
              key={o.recipient_id}
              offer={o}
              isResponding={false}
              message={resultMessage[o.recipient_id]}
              onAccept={() => {}}
              onDecline={() => {}}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OfferCard({
  offer,
  isResponding,
  message,
  onAccept,
  onDecline,
}: {
  offer: OfferData;
  isResponding: boolean;
  message?: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const isPending = offer.recipient_status === "PENDING";
  const isAccepted = offer.recipient_status === "ACCEPTED";
  const isDeclined = offer.recipient_status === "DECLINED";
  const isExpired = offer.recipient_status === "EXPIRED" || offer.recipient_status === "CLOSED";
  const offerFull = offer.offer?.offer_status === "FILLED" || offer.offer?.offer_status === "CLOSED";

  // Can still accept if pending and offer not full
  const canRespond = isPending && !offerFull;

  const positionsLeft = offer.offer
    ? offer.offer.positions_required - offer.offer.positions_filled
    : 0;

  return (
    <div
      className={`bg-white rounded-2xl border p-4 mb-3 ${
        isPending ? "border-amber-200 shadow-sm" : "border-gray-200"
      }`}
    >
      {/* Event name */}
      {offer.event && (
        <>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-gray-900">{offer.event.name}</h3>
            {isPending && (
              <span className="text-xs font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                NEW
              </span>
            )}
            {isAccepted && (
              <span className="text-xs font-medium bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                ACCEPTED
              </span>
            )}
            {isDeclined && (
              <span className="text-xs font-medium bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                DECLINED
              </span>
            )}
            {isExpired && (
              <span className="text-xs font-medium bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                EXPIRED
              </span>
            )}
          </div>

          <div className="space-y-1 text-sm mb-3">
            <div className="text-gray-700 font-medium">{formatDate(offer.event.event_date)}</div>
            <div className="text-gray-900 font-semibold">
              {formatTime(offer.event.start_time)} – {formatTime(offer.event.finish_time)}
            </div>
            {offer.offer?.role && (
              <div className="text-gray-600">🏷️ {offer.offer.role}</div>
            )}
            {offer.event.location && (
              <div className="text-gray-600">📍 {offer.event.location}</div>
            )}
            {isPending && positionsLeft > 0 && (
              <div className="text-xs text-blue-600 font-medium">
                {positionsLeft} position{positionsLeft !== 1 ? "s" : ""} still available
              </div>
            )}
          </div>
        </>
      )}

      {/* Message */}
      {message && (
        <div
          className={`text-sm rounded-lg p-2 mb-3 ${
            message.startsWith("✅")
              ? "bg-green-50 text-green-700"
              : message === "Declined."
                ? "bg-gray-50 text-gray-600"
                : "bg-red-50 text-red-700"
          }`}
        >
          {message}
        </div>
      )}

      {/* Accept / Decline */}
      {canRespond && !message && (
        <div className="flex gap-2">
          <button
            onClick={onAccept}
            disabled={isResponding}
            className="flex-1 bg-green-600 text-white rounded-xl py-3 text-sm font-semibold
                       hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {isResponding ? "…" : "Accept Shift"}
          </button>
          <button
            onClick={onDecline}
            disabled={isResponding}
            className="flex-1 border border-gray-300 text-gray-600 rounded-xl py-3 text-sm
                       font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Not Available
          </button>
        </div>
      )}

      {/* If offer became full while pending */}
      {isPending && offerFull && !message && (
        <div className="text-sm text-gray-500 bg-gray-50 rounded-lg p-2 text-center">
          This shift is now fully staffed.
        </div>
      )}

      {/* Accepted → link to shift */}
      {isAccepted && offer.shift_id && (
        <Link
          href={`/employee/shifts/${offer.shift_id}`}
          className="block text-center text-sm text-blue-600 hover:underline mt-1"
        >
          View Shift →
        </Link>
      )}
    </div>
  );
}
