"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type CheckoutStep = "QR_SCAN" | "GPS_VERIFY" | "SELFIE" | "SUBMITTING" | "DONE" | "ERROR";

interface AttendanceData {
  attendanceRequired: boolean;
  record: {
    id: string;
    checkin_status: string;
    checkout_status: string;
    actual_checkin: string | null;
  } | null;
  settings: {
    checkout_method: string;
    qr_mode: string;
    allowed_radius_metres: number;
  } | null;
  location: { name: string; latitude: number | null; longitude: number | null } | null;
  shift: { scheduled_start: string; scheduled_finish: string } | null;
}

interface CheckoutResult {
  success: boolean;
  checkoutStatus: string;
  checkoutDistanceMetres: number | null;
  gpsOutOfRange: boolean;
  minsEarly: number;
  minsLate: number;
  earlyDeparture: boolean;
  lateDeparture: boolean;
  requiresReview: boolean;
  locationName: string;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function CheckoutPage() {
  const { shiftId } = useParams<{ shiftId: string }>();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AttendanceData | null>(null);
  const [step, setStep] = useState<CheckoutStep>("GPS_VERIFY");
  const [error, setError] = useState("");
  const [result, setResult] = useState<CheckoutResult | null>(null);

  // Collected data
  const [qrToken, setQrToken] = useState("");
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [manualQr, setManualQr] = useState("");

  // Load attendance status
  useEffect(() => {
    fetch(`/api/attendance/status?shiftId=${shiftId}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        if (d.record?.checkout_status && d.record.checkout_status !== "NOT_CHECKED_OUT") {
          // Already checked out
          setStep("DONE");
          setResult({
            success: true,
            checkoutStatus: d.record.checkout_status,
            checkoutDistanceMetres: null,
            gpsOutOfRange: false,
            minsEarly: 0,
            minsLate: 0,
            earlyDeparture: false,
            lateDeparture: false,
            requiresReview: false,
            locationName: d.location?.name || "",
          });
        } else {
          // Determine first step based on checkout method
          const method = d.settings?.checkout_method || "BUTTON_ONLY";
          if (method === "BUTTON_ONLY") {
            // Auto checkout immediately
            submitCheckout(null, null, null, true);
          } else if (method === "QR_GPS" || method === "QR_GPS_SELFIE") {
            setStep("QR_SCAN");
          } else {
            setStep("GPS_VERIFY");
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shiftId]);

  const submitCheckout = async (
    qr: string | null,
    coords: { lat: number; lng: number } | null,
    selfie: File | null,
    auto = false
  ) => {
    setStep("SUBMITTING");
    setError("");

    const formData = new FormData();
    formData.append("shiftId", shiftId);
    if (auto) formData.append("auto", "true");
    if (qr) formData.append("qrToken", qr);
    if (coords) {
      formData.append("latitude", String(coords.lat));
      formData.append("longitude", String(coords.lng));
    }
    if (selfie) formData.append("selfie", selfie);

    try {
      const res = await fetch("/api/attendance/checkout", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Check-out failed.");
        setStep("ERROR");
        return;
      }

      setResult(data);
      setStep("DONE");
    } catch {
      setError("Network error. Please try again.");
      setStep("ERROR");
    }
  };

  // QR submit handler
  const handleQrSubmit = () => {
    const token = manualQr.trim();
    if (!token) return;
    setQrToken(token);

    const method = data?.settings?.checkout_method || "GPS_ONLY";
    if (method === "QR_GPS" || method === "QR_GPS_SELFIE") {
      setStep("GPS_VERIFY");
    } else {
      submitCheckout(token, null, null);
    }
  };

  // GPS handler
  const handleGps = () => {
    if (!navigator.geolocation) {
      setError("GPS not available on this device.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setGpsCoords(coords);

        const method = data?.settings?.checkout_method || "GPS_ONLY";
        if (method === "QR_GPS_SELFIE") {
          setStep("SELFIE");
        } else {
          submitCheckout(qrToken || null, coords, null);
        }
      },
      (err) => {
        setError(`GPS error: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  // Selfie handler
  const handleSelfieCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelfieFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setSelfiePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSelfieSubmit = () => {
    if (!selfieFile) return;
    submitCheckout(qrToken || null, gpsCoords, selfieFile);
  };

  // Determine completed steps for progress bar
  const allSteps: CheckoutStep[] = [];
  const method = data?.settings?.checkout_method || "BUTTON_ONLY";
  if (method === "QR_GPS" || method === "QR_GPS_SELFIE") allSteps.push("QR_SCAN");
  if (method !== "BUTTON_ONLY") allSteps.push("GPS_VERIFY");
  if (method === "QR_GPS_SELFIE") allSteps.push("SELFIE");

  const stepLabels: Record<string, string> = {
    QR_SCAN: "Scan QR",
    GPS_VERIFY: "Verify Location",
    SELFIE: "Selfie",
  };

  const currentIndex = allSteps.indexOf(step);

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading…</div>;
  }

  return (
    <div className="max-w-lg mx-auto">
      <button
        onClick={() => router.push(`/employee/shifts/${shiftId}`)}
        className="text-blue-600 text-sm mb-4 inline-block"
      >
        ← Back to Shift
      </button>

      {/* Header */}
      <div className="bg-indigo-600 text-white rounded-t-xl p-5 mb-0">
        <h1 className="text-xl font-bold">Check Out</h1>
        <p className="text-indigo-200 text-sm mt-1">
          {data?.location?.name || ""}
        </p>
        {data?.shift && (
          <p className="text-indigo-200 text-sm">
            {formatTime(data.shift.scheduled_start)} – {formatTime(data.shift.scheduled_finish)}
          </p>
        )}
      </div>

      {/* Progress bar */}
      {allSteps.length > 0 && step !== "DONE" && step !== "ERROR" && step !== "SUBMITTING" && (
        <div className="bg-white border-x border-gray-200 px-5 py-3 flex items-center gap-2">
          {allSteps.map((s, i) => {
            const completed = i < currentIndex;
            const active = s === step;
            return (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    completed
                      ? "bg-green-500 text-white"
                      : active
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {completed ? "✓" : i + 1}
                </div>
                <span className={`text-xs ${active ? "text-indigo-600 font-medium" : "text-gray-400"}`}>
                  {stepLabels[s]}
                </span>
                {i < allSteps.length - 1 && (
                  <div className={`flex-1 h-0.5 ${completed ? "bg-green-400" : "bg-gray-200"}`} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Content area */}
      <div className="bg-white rounded-b-xl border border-gray-200 border-t-0 p-5">
        {/* QR Scan Step */}
        {step === "QR_SCAN" && (
          <div>
            <h2 className="text-lg font-semibold mb-2">🔲 Scan Site QR Code</h2>
            <p className="text-gray-500 text-sm mb-4">
              Scan the QR code at {data?.location?.name} to verify checkout.
            </p>

            <div className="border-t border-gray-200 pt-4 mt-4">
              <p className="text-sm text-gray-400 mb-2">Or enter QR code manually:</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualQr}
                  onChange={(e) => setManualQr(e.target.value)}
                  placeholder="WFA:CHECKIN:..."
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <button
                  onClick={handleQrSubmit}
                  disabled={!manualQr.trim()}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  Submit
                </button>
              </div>
            </div>
          </div>
        )}

        {/* GPS Step */}
        {step === "GPS_VERIFY" && (
          <div>
            <h2 className="text-lg font-semibold mb-2">📍 Verify Location</h2>
            <p className="text-gray-500 text-sm mb-4">
              We need to verify you&apos;re at {data?.location?.name}.
            </p>

            <button
              onClick={handleGps}
              className="w-full bg-indigo-600 text-white py-4 rounded-xl font-semibold text-base hover:bg-indigo-700 transition-colors"
            >
              📍 Share My Location
            </button>

            {error && (
              <p className="text-red-600 text-sm mt-3">{error}</p>
            )}
          </div>
        )}

        {/* Selfie Step */}
        {step === "SELFIE" && (
          <div>
            <h2 className="text-lg font-semibold mb-2">📸 Checkout Selfie</h2>
            <p className="text-gray-500 text-sm mb-4">
              Take a selfie to confirm your identity at checkout.
            </p>

            {!selfiePreview ? (
              <label className="block w-full bg-indigo-600 text-white py-4 rounded-xl font-semibold text-base text-center cursor-pointer hover:bg-indigo-700 transition-colors">
                📸 Take Selfie
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  onChange={handleSelfieCapture}
                  className="hidden"
                />
              </label>
            ) : (
              <div>
                <img
                  src={selfiePreview}
                  alt="Checkout selfie"
                  className="w-full max-w-[250px] mx-auto rounded-lg border border-gray-200 mb-3"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => { setSelfieFile(null); setSelfiePreview(null); }}
                    className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium"
                  >
                    Retake
                  </button>
                  <button
                    onClick={handleSelfieSubmit}
                    className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium"
                  >
                    Use Photo
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Submitting */}
        {step === "SUBMITTING" && (
          <div className="text-center py-8">
            <div className="inline-block w-10 h-10 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4" />
            <p className="text-gray-500">Submitting check-out…</p>
          </div>
        )}

        {/* Error */}
        {step === "ERROR" && (
          <div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
              <h3 className="font-semibold text-red-700 mb-1">Check-Out Failed</h3>
              <p className="text-red-600 text-sm">{error}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => router.push(`/employee/shifts/${shiftId}`)}
                className="flex-1 border border-gray-300 text-gray-700 py-3 rounded-xl font-medium"
              >
                Back to Shift
              </button>
              <button
                onClick={() => {
                  setError("");
                  const m = data?.settings?.checkout_method || "BUTTON_ONLY";
                  if (m === "QR_GPS" || m === "QR_GPS_SELFIE") setStep("QR_SCAN");
                  else if (m === "BUTTON_ONLY") submitCheckout(null, null, null, true);
                  else setStep("GPS_VERIFY");
                }}
                className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-medium"
              >
                Try Again
              </button>
            </div>
          </div>
        )}

        {/* Done */}
        {step === "DONE" && result && (
          <div>
            {/* Status banner */}
            <div className={`rounded-lg p-4 mb-4 text-center ${
              result.checkoutStatus === "CHECKED_OUT" || result.checkoutStatus === "AUTO_CHECKOUT"
                ? "bg-green-50 border border-green-200"
                : result.checkoutStatus === "EARLY_DEPARTURE"
                ? "bg-amber-50 border border-amber-200"
                : result.checkoutStatus === "LATE_DEPARTURE"
                ? "bg-amber-50 border border-amber-200"
                : "bg-yellow-50 border border-yellow-200"
            }`}>
              <div className="text-2xl mb-1">
                {result.checkoutStatus === "CHECKED_OUT" || result.checkoutStatus === "AUTO_CHECKOUT" ? "✅" : "⚠️"}
              </div>
              <h3 className={`font-semibold ${
                result.checkoutStatus === "CHECKED_OUT" || result.checkoutStatus === "AUTO_CHECKOUT" ? "text-green-700" : "text-amber-700"
              }`}>
                {result.checkoutStatus === "CHECKED_OUT" && "Checked Out"}
                {result.checkoutStatus === "AUTO_CHECKOUT" && "Auto Checked Out"}
                {result.checkoutStatus === "EARLY_DEPARTURE" && "Checked Out — Early Departure"}
                {result.checkoutStatus === "LATE_DEPARTURE" && "Checked Out — Late Finish"}
                {result.checkoutStatus === "NEEDS_REVIEW" && "Checked Out — Needs Review"}
              </h3>
              <p className="text-sm text-gray-500 mt-1">{result.locationName}</p>
            </div>

            {/* Details */}
            <div className="space-y-1 text-sm mb-4">
              {result.checkoutDistanceMetres != null && (
                <p className="flex items-center gap-2">
                  <span className={result.gpsOutOfRange ? "text-amber-600" : "text-green-600"}>✓</span>
                  {result.checkoutDistanceMetres}m from site
                </p>
              )}
              {result.earlyDeparture && (
                <p className="flex items-center gap-2">
                  <span className="text-amber-600">⚠</span>
                  Left {result.minsEarly} mins early
                </p>
              )}
              {result.lateDeparture && (
                <p className="flex items-center gap-2">
                  <span className="text-amber-600">⚠</span>
                  {result.minsLate} mins past scheduled finish
                </p>
              )}
              {result.requiresReview && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 mt-2">
                  <p className="text-amber-700 text-xs">⚠ Your checkout has been flagged for admin review.</p>
                </div>
              )}
            </div>

            <button
              onClick={() => router.push(`/employee/shifts/${shiftId}`)}
              className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold"
            >
              → Go to Shift
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
