"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import jsQR from "jsqr";

/* ── Types ─────────────────────────────────────────────────── */
interface AttendanceStatus {
  attendanceRequired: boolean;
  record: {
    id: string;
    checkin_status: string;
    actual_checkin: string;
    qr_verified: boolean;
    checkin_distance_metres: number | null;
  } | null;
  settings: {
    qr_required: boolean;
    qr_mode: string;
    gps_required: boolean;
    allowed_radius_metres: number;
    selfie_required: boolean;
    site_photo_required: boolean;
    early_checkin_minutes: number;
    late_grace_minutes: number;
  } | null;
  location: {
    id: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
  } | null;
  steps: string[];
  shift?: {
    id: string;
    scheduled_start: string;
    scheduled_finish: string;
    status: string;
  };
}

interface CheckinResult {
  success: boolean;
  checkinStatus: string;
  distanceMetres: number | null;
  gpsOutOfRange: boolean;
  qrVerified: boolean;
  minsLate: number;
  withinGrace: boolean;
  requiresReview: boolean;
  locationName: string;
}

/* ── Step enum ─────────────────────────────────────────────── */
type Step = "LOADING" | "QR_SCAN" | "GPS_VERIFY" | "SELFIE" | "SITE_PHOTO" | "SUBMITTING" | "DONE" | "ERROR";

/* ── Helpers ───────────────────────────────────────────────── */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/* ── Component ─────────────────────────────────────────────── */
export default function CheckInPage() {
  const params = useParams();
  const router = useRouter();
  const shiftId = params.shiftId as string;

  // Status from the API
  const [status, setStatus] = useState<AttendanceStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Current step
  const [currentStep, setCurrentStep] = useState<Step>("LOADING");
  const [requiredSteps, setRequiredSteps] = useState<string[]>([]);
  const stepIndex = useRef(0);

  // Collected data
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsDistance, setGpsDistance] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState("");
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [sitePhotoFile, setSitePhotoFile] = useState<File | null>(null);
  const [sitePhotoPreview, setSitePhotoPreview] = useState<string | null>(null);

  // Result
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // QR scanning
  const [qrInput, setQrInput] = useState("");
  const [qrError, setQrError] = useState("");
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Refs for file inputs
  const selfieInputRef = useRef<HTMLInputElement>(null);
  const sitePhotoInputRef = useRef<HTMLInputElement>(null);

  // GPS loading state
  const [gpsLoading, setGpsLoading] = useState(false);

  /* ── Load attendance status ──────────────────────────────── */
  useEffect(() => {
    fetch(`/api/attendance/status?shiftId=${shiftId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          setCurrentStep("ERROR");
        } else if (!data.attendanceRequired) {
          setError("Attendance is not required for this shift.");
          setCurrentStep("ERROR");
        } else if (data.record && data.record.checkin_status !== "NOT_CHECKED_IN") {
          // Already checked in — show result
          setStatus(data);
          setResult({
            success: true,
            checkinStatus: data.record.checkin_status,
            distanceMetres: data.record.checkin_distance_metres,
            gpsOutOfRange: false,
            qrVerified: data.record.qr_verified,
            minsLate: 0,
            withinGrace: false,
            requiresReview: data.record.requires_review,
            locationName: data.location?.name || "",
          });
          setCurrentStep("DONE");
        } else {
          setStatus(data);
          const steps = data.steps as string[];
          setRequiredSteps(steps);
          if (steps.length > 0) {
            setCurrentStep(steps[0] as Step);
            stepIndex.current = 0;
          } else {
            // No steps required — just submit directly
            setCurrentStep("SUBMITTING");
          }
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load attendance status.");
        setCurrentStep("ERROR");
        setLoading(false);
      });
  }, [shiftId]);

  /* ── Step navigation ─────────────────────────────────────── */
  const advanceStep = useCallback(() => {
    const next = stepIndex.current + 1;
    if (next < requiredSteps.length) {
      stepIndex.current = next;
      setCurrentStep(requiredSteps[next] as Step);
    } else {
      setCurrentStep("SUBMITTING");
    }
  }, [requiredSteps]);

  /* ── Cleanup camera on unmount / step change ─────────────── */
  useEffect(() => {
    return () => {
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  /* ── Auto-submit when we reach SUBMITTING ────────────────── */
  useEffect(() => {
    if (currentStep === "SUBMITTING" && !submitting) {
      submitCheckin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  /* ── QR: Start camera scanning (jsQR — works on all browsers) */
  async function startQrScan() {
    setScanning(true);
    setQrError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Use jsQR to decode frames from the canvas — works on all browsers
      scanIntervalRef.current = setInterval(() => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "dontInvert",
        });

        if (code && code.data) {
          const value = code.data;
          if (value.startsWith("WFA:CHECKIN:") || value.startsWith("WFA:DYN:")) {
            handleQrScanned(value);
          }
        }
      }, 300);
    } catch {
      setQrError("Unable to access camera. Please allow camera access and try again.");
      setScanning(false);
    }
  }

  function stopCamera() {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
  }

  function handleQrScanned(value: string) {
    stopCamera();
    setQrToken(value);
    setQrError("");
    advanceStep();
  }

  /* ── QR: Manual entry ────────────────────────────────────── */
  function handleQrManualSubmit() {
    const val = qrInput.trim();
    if (!val.startsWith("WFA:CHECKIN:") && !val.startsWith("WFA:DYN:")) {
      setQrError("Invalid QR code. It should start with WFA:CHECKIN: or WFA:DYN:");
      return;
    }
    handleQrScanned(val);
  }

  /* ── GPS: Get location ───────────────────────────────────── */
  function requestGps() {
    setGpsLoading(true);
    setGpsError("");

    if (!navigator.geolocation) {
      setGpsError("Geolocation is not supported by your browser.");
      setGpsLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setGpsCoords({ lat, lng });

        // Calculate distance client-side for display (server recalculates)
        let computedDistance: number | null = null;
        if (status?.location?.latitude != null && status?.location?.longitude != null) {
          const R = 6_371_000;
          const toRad = (d: number) => (d * Math.PI) / 180;
          const dLat = toRad(status.location.latitude - lat);
          const dLng = toRad(status.location.longitude - lng);
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat)) *
              Math.cos(toRad(status.location.latitude)) *
              Math.sin(dLng / 2) ** 2;
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          computedDistance = Math.round(R * c);
          setGpsDistance(computedDistance);
        }

        setGpsLoading(false);
        // Auto-advance only if within allowed radius; if out of range,
        // let the user see the warning and decide via "Continue Anyway"
        const allowedRadius = status?.settings?.allowed_radius_metres ?? 100;
        if (computedDistance === null || computedDistance <= allowedRadius) {
          setTimeout(() => advanceStep(), 1200);
        }
      },
      (err) => {
        setGpsError(
          err.code === 1
            ? "Location permission denied. Please enable location access."
            : err.code === 2
            ? "Location unavailable. Please try again."
            : "Location request timed out. Please try again."
        );
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  /* ── Selfie: Capture ─────────────────────────────────────── */
  function handleSelfieCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelfieFile(file);
    setSelfiePreview(URL.createObjectURL(file));
  }

  function confirmSelfie() {
    advanceStep();
  }

  /* ── Site Photo: Capture ─────────────────────────────────── */
  function handleSitePhotoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSitePhotoFile(file);
    setSitePhotoPreview(URL.createObjectURL(file));
  }

  function confirmSitePhoto() {
    advanceStep();
  }

  /* ── Submit check-in ─────────────────────────────────────── */
  async function submitCheckin() {
    setSubmitting(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("shiftId", shiftId);

      if (qrToken) formData.append("qrToken", qrToken);
      if (gpsCoords) {
        formData.append("latitude", gpsCoords.lat.toString());
        formData.append("longitude", gpsCoords.lng.toString());
      }
      if (selfieFile) formData.append("selfie", selfieFile);
      if (sitePhotoFile) formData.append("sitePhoto", sitePhotoFile);

      const res = await fetch("/api/attendance/checkin", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Check-in failed.");
        setCurrentStep("ERROR");
      } else {
        setResult(data);
        setCurrentStep("DONE");
      }
    } catch {
      setError("Check-in failed. Please try again.");
      setCurrentStep("ERROR");
    }
    setSubmitting(false);
  }

  /* ── Progress bar ────────────────────────────────────────── */
  function getStepNumber(): number {
    if (currentStep === "DONE" || currentStep === "SUBMITTING") return requiredSteps.length;
    const idx = requiredSteps.indexOf(currentStep);
    return idx >= 0 ? idx : 0;
  }

  const stepLabels: Record<string, string> = {
    QR_SCAN: "Scan QR",
    GPS_VERIFY: "Verify Location",
    SELFIE: "Take Selfie",
    SITE_PHOTO: "Site Photo",
  };

  /* ── Render ──────────────────────────────────────────────── */
  if (loading || currentStep === "LOADING") {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="animate-spin inline-block w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full mb-4" />
        <p className="text-gray-500">Loading check-in…</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-8">
      {/* Header */}
      <button
        onClick={() => router.push(`/employee/shifts/${shiftId}`)}
        className="text-sm text-blue-600 hover:underline mb-4 inline-block"
      >
        ← Back to Shift
      </button>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Top bar with location + time */}
        <div className="bg-blue-600 text-white px-5 py-4">
          <h1 className="text-lg font-bold">Check In</h1>
          {status?.location && (
            <p className="text-blue-100 text-sm mt-0.5">{status.location.name}</p>
          )}
          {status?.shift && (
            <p className="text-blue-200 text-xs mt-1">
              {formatTime(status.shift.scheduled_start)} – {formatTime(status.shift.scheduled_finish)}
            </p>
          )}
        </div>

        {/* Progress steps */}
        {requiredSteps.length > 0 && currentStep !== "DONE" && currentStep !== "ERROR" && (
          <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center gap-2">
              {requiredSteps.map((step, i) => {
                const done = i < getStepNumber();
                const active = i === getStepNumber();
                return (
                  <div key={step} className="flex items-center gap-2 flex-1">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                        done
                          ? "bg-green-500 text-white"
                          : active
                          ? "bg-blue-600 text-white"
                          : "bg-gray-200 text-gray-400"
                      }`}
                    >
                      {done ? "✓" : i + 1}
                    </div>
                    <span
                      className={`text-xs truncate ${
                        done ? "text-green-600" : active ? "text-blue-600 font-medium" : "text-gray-400"
                      }`}
                    >
                      {stepLabels[step] || step}
                    </span>
                    {i < requiredSteps.length - 1 && (
                      <div className={`flex-1 h-0.5 ${done ? "bg-green-300" : "bg-gray-200"}`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="p-5">
          {/* ── QR_SCAN Step ──────────────────────────────── */}
          {currentStep === "QR_SCAN" && (
            <div>
              <h2 className="text-base font-semibold text-gray-900 mb-1">📱 Scan Site QR Code</h2>
              <p className="text-sm text-gray-500 mb-4">
                Scan the QR code at {status?.location?.name || "your work location"} to verify your presence.
              </p>

              {/* Camera view */}
              {scanning && (
                <div className="relative mb-4 rounded-xl overflow-hidden bg-black aspect-square">
                  <video
                    ref={videoRef}
                    className="w-full h-full object-cover"
                    playsInline
                    muted
                  />
                  {/* Scan overlay */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-48 h-48 border-2 border-white/60 rounded-2xl" />
                  </div>
                  <div className="absolute bottom-3 left-0 right-0 text-center">
                    <span className="bg-black/60 text-white text-xs px-3 py-1 rounded-full">
                      Point camera at QR code
                    </span>
                  </div>
                </div>
              )}

              {!scanning && (
                <button
                  onClick={startQrScan}
                  className="w-full bg-blue-600 text-white rounded-xl py-3.5 text-base font-semibold hover:bg-blue-700 transition-colors mb-3"
                >
                  📷 Open Camera to Scan
                </button>
              )}

              {scanning && (
                <button
                  onClick={stopCamera}
                  className="w-full bg-gray-200 text-gray-700 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-300 transition-colors mb-3"
                >
                  Stop Camera
                </button>
              )}

              {qrError && (
                <div className="bg-amber-50 text-amber-700 text-sm rounded-lg p-3 border border-amber-200 mb-3">
                  {qrError}
                </div>
              )}

              {/* Manual entry fallback */}
              <div className="border-t border-gray-200 pt-4 mt-4">
                <p className="text-xs text-gray-400 mb-2">Or enter QR code manually:</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={qrInput}
                    onChange={(e) => setQrInput(e.target.value)}
                    placeholder="WFA:CHECKIN:..."
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  <button
                    onClick={handleQrManualSubmit}
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
                  >
                    Submit
                  </button>
                </div>
              </div>

              <canvas ref={canvasRef} className="hidden" />
            </div>
          )}

          {/* ── GPS_VERIFY Step ───────────────────────────── */}
          {currentStep === "GPS_VERIFY" && (
            <div>
              <h2 className="text-base font-semibold text-gray-900 mb-1">📍 Verify Location</h2>
              <p className="text-sm text-gray-500 mb-4">
                We need to verify you&apos;re at {status?.location?.name || "your work location"}.
              </p>

              {!gpsCoords && !gpsLoading && (
                <button
                  onClick={requestGps}
                  className="w-full bg-blue-600 text-white rounded-xl py-3.5 text-base font-semibold hover:bg-blue-700 transition-colors"
                >
                  📍 Share My Location
                </button>
              )}

              {gpsLoading && (
                <div className="text-center py-8">
                  <div className="animate-spin inline-block w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full mb-3" />
                  <p className="text-sm text-gray-500">Getting your location…</p>
                </div>
              )}

              {gpsCoords && gpsDistance !== null && (
                <div className={`rounded-xl p-4 ${
                  gpsDistance <= (status?.settings?.allowed_radius_metres ?? 100)
                    ? "bg-green-50 border border-green-200"
                    : "bg-amber-50 border border-amber-200"
                }`}>
                  {gpsDistance <= (status?.settings?.allowed_radius_metres ?? 100) ? (
                    <>
                      <div className="text-green-600 text-lg font-bold mb-1">✓ Location Verified</div>
                      <p className="text-sm text-green-700">
                        You are {gpsDistance}m from {status?.location?.name}.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="text-amber-600 text-lg font-bold mb-1">⚠ Outside Range</div>
                      <p className="text-sm text-amber-700">
                        You are {gpsDistance}m from {status?.location?.name} (allowed: {status?.settings?.allowed_radius_metres ?? 100}m).
                      </p>
                      <p className="text-xs text-amber-600 mt-2">
                        You can still check in — your attendance will be flagged for admin review.
                      </p>
                      <button
                        onClick={advanceStep}
                        className="mt-3 w-full bg-amber-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-amber-700"
                      >
                        Continue Anyway
                      </button>
                    </>
                  )}
                </div>
              )}

              {gpsError && (
                <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200 mt-3">
                  {gpsError}
                  <button
                    onClick={requestGps}
                    className="mt-2 w-full bg-red-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-red-700"
                  >
                    Try Again
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── SELFIE Step ───────────────────────────────── */}
          {currentStep === "SELFIE" && (
            <div>
              <h2 className="text-base font-semibold text-gray-900 mb-1">🤳 Take a Selfie</h2>
              <p className="text-sm text-gray-500 mb-4">
                Take a photo to verify your identity.
              </p>

              {!selfiePreview ? (
                <>
                  <input
                    ref={selfieInputRef}
                    type="file"
                    accept="image/*"
                    capture="user"
                    onChange={handleSelfieCapture}
                    className="hidden"
                  />
                  <button
                    onClick={() => selfieInputRef.current?.click()}
                    className="w-full bg-blue-600 text-white rounded-xl py-3.5 text-base font-semibold hover:bg-blue-700 transition-colors"
                  >
                    📷 Take Photo
                  </button>
                </>
              ) : (
                <div>
                  <img
                    src={selfiePreview}
                    alt="Selfie preview"
                    className="w-full aspect-square object-cover rounded-xl border border-gray-200 mb-3"
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setSelfieFile(null);
                        setSelfiePreview(null);
                      }}
                      className="flex-1 bg-gray-200 text-gray-700 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-300"
                    >
                      Retake
                    </button>
                    <button
                      onClick={confirmSelfie}
                      className="flex-1 bg-green-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-green-700"
                    >
                      ✓ Use This Photo
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── SITE_PHOTO Step ───────────────────────────── */}
          {currentStep === "SITE_PHOTO" && (
            <div>
              <h2 className="text-base font-semibold text-gray-900 mb-1">🏢 Site Photo</h2>
              <p className="text-sm text-gray-500 mb-4">
                Take a photo showing your current work location.
              </p>

              {!sitePhotoPreview ? (
                <>
                  <input
                    ref={sitePhotoInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleSitePhotoCapture}
                    className="hidden"
                  />
                  <button
                    onClick={() => sitePhotoInputRef.current?.click()}
                    className="w-full bg-blue-600 text-white rounded-xl py-3.5 text-base font-semibold hover:bg-blue-700 transition-colors"
                  >
                    📷 Take Photo
                  </button>
                </>
              ) : (
                <div>
                  <img
                    src={sitePhotoPreview}
                    alt="Site photo preview"
                    className="w-full aspect-[4/3] object-cover rounded-xl border border-gray-200 mb-3"
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setSitePhotoFile(null);
                        setSitePhotoPreview(null);
                      }}
                      className="flex-1 bg-gray-200 text-gray-700 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-300"
                    >
                      Retake
                    </button>
                    <button
                      onClick={confirmSitePhoto}
                      className="flex-1 bg-green-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-green-700"
                    >
                      ✓ Use This Photo
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── SUBMITTING ────────────────────────────────── */}
          {currentStep === "SUBMITTING" && (
            <div className="text-center py-8">
              <div className="animate-spin inline-block w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full mb-4" />
              <p className="text-gray-600 font-medium">Submitting check-in…</p>
            </div>
          )}

          {/* ── DONE ──────────────────────────────────────── */}
          {currentStep === "DONE" && result && (
            <div>
              {/* Status header */}
              <div className={`text-center py-4 rounded-xl mb-4 ${
                result.checkinStatus === "PRESENT"
                  ? "bg-green-50"
                  : result.checkinStatus === "LATE"
                  ? "bg-amber-50"
                  : "bg-amber-50"
              }`}>
                <div className={`text-3xl mb-2`}>
                  {result.checkinStatus === "PRESENT" ? "✅" : "⚠️"}
                </div>
                <h2 className={`text-xl font-bold ${
                  result.checkinStatus === "PRESENT" ? "text-green-700" : "text-amber-700"
                }`}>
                  {result.checkinStatus === "PRESENT"
                    ? "Check-In Complete"
                    : result.checkinStatus === "LATE"
                    ? "Checked In — Late"
                    : "Checked In — Needs Review"}
                </h2>
                <p className="text-sm text-gray-600 mt-1">{result.locationName}</p>
              </div>

              {/* Details */}
              <div className="space-y-3 text-sm">
                {result.qrVerified && (
                  <div className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    <span className="text-gray-700">QR Verified</span>
                  </div>
                )}
                {result.distanceMetres !== null && (
                  <div className="flex items-center gap-2">
                    <span className={result.gpsOutOfRange ? "text-amber-500" : "text-green-500"}>
                      {result.gpsOutOfRange ? "⚠" : "✓"}
                    </span>
                    <span className="text-gray-700">
                      {result.distanceMetres}m from site
                      {result.gpsOutOfRange ? " (outside range)" : ""}
                    </span>
                  </div>
                )}
                {result.minsLate > 0 && (
                  <div className="flex items-center gap-2">
                    <span className={result.withinGrace ? "text-green-500" : "text-amber-500"}>
                      {result.withinGrace ? "✓" : "⚠"}
                    </span>
                    <span className="text-gray-700">
                      {result.minsLate} min{result.minsLate !== 1 ? "s" : ""} late
                      {result.withinGrace ? " (within grace)" : ""}
                    </span>
                  </div>
                )}
                {result.requiresReview && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-700 text-xs mt-2">
                    ⚠ Your attendance has been flagged for admin review.
                  </div>
                )}
              </div>

              {/* Action */}
              <button
                onClick={() => router.push(`/employee/shifts/${shiftId}`)}
                className="w-full mt-6 bg-blue-600 text-white rounded-xl py-3.5 text-base font-bold hover:bg-blue-700 transition-colors"
              >
                → Go to Shift
              </button>
            </div>
          )}

          {/* ── ERROR ─────────────────────────────────────── */}
          {currentStep === "ERROR" && (
            <div>
              <div className="bg-red-50 text-red-700 text-sm rounded-lg p-4 border border-red-200 mb-4">
                <div className="font-semibold mb-1">Check-In Failed</div>
                {error}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => router.push(`/employee/shifts/${shiftId}`)}
                  className="flex-1 bg-gray-200 text-gray-700 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-300"
                >
                  Back to Shift
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-medium hover:bg-blue-700"
                >
                  Try Again
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
