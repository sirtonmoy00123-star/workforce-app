"use client";

import { useEffect, useState, useCallback } from "react";

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface WorkLocation {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  created_at: string;
}

interface AttendanceSettings {
  id: string;
  location_id: string;
  attendance_required: boolean;
  qr_required: boolean;
  qr_mode: "STATIC" | "DYNAMIC";
  gps_required: boolean;
  allowed_radius_metres: number;
  selfie_required: boolean;
  site_photo_required: boolean;
  early_checkin_minutes: number;
  late_grace_minutes: number;
  early_departure_review_minutes: number;
  late_finish_review_minutes: number;
  rounding_minutes: number;
  checkout_method: string;
  dynamic_qr_refresh_seconds: number;
}

// ────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────

export default function LocationsPage() {
  // List state
  const [locations, setLocations] = useState<WorkLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [successMsg, setSuccessMsg] = useState("");

  // Create / Edit location modal
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<WorkLocation | null>(null);
  const [locName, setLocName] = useState("");
  const [locAddress, setLocAddress] = useState("");
  const [locLat, setLocLat] = useState("");
  const [locLng, setLocLng] = useState("");
  const [locSaving, setLocSaving] = useState(false);
  const [locError, setLocError] = useState("");

  // Track which locations have attendance configured (for badges)
  const [configuredLocationIds, setConfiguredLocationIds] = useState<Set<string>>(new Set());

  // Attendance settings sheet
  const [settingsLocation, setSettingsLocation] = useState<WorkLocation | null>(null);
  const [settings, setSettings] = useState<AttendanceSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");

  // Settings form state
  const [sAttRequired, setSAttRequired] = useState(false);
  const [sQrRequired, setSQrRequired] = useState(false);
  const [sQrMode, setSQrMode] = useState<"STATIC" | "DYNAMIC">("STATIC");
  const [sGpsRequired, setSGpsRequired] = useState(false);
  const [sRadius, setSRadius] = useState(100);
  const [sSelfie, setSSelfie] = useState(false);
  const [sSitePhoto, setSSitePhoto] = useState(false);
  const [sEarlyCheckin, setSEarlyCheckin] = useState(15);
  const [sLateGrace, setSLateGrace] = useState(10);
  const [sEarlyDeparture, setSEarlyDeparture] = useState(10);
  const [sLateFinish, setSLateFinish] = useState(15);
  const [sRounding, setSRounding] = useState(0);
  const [sCheckoutMethod, setSCheckoutMethod] = useState("BUTTON_ONLY");
  const [sDynamicRefresh, setSDynamicRefresh] = useState(60);

  // ── Fetch locations ──
  const fetchLocations = useCallback(async () => {
    try {
      const res = await fetch("/api/work-locations");
      const data = await res.json();
      if (Array.isArray(data)) setLocations(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  // ── Create / Edit location ──
  function openCreateModal() {
    setEditingLocation(null);
    setLocName("");
    setLocAddress("");
    setLocLat("");
    setLocLng("");
    setLocError("");
    setShowLocationModal(true);
  }

  function openEditModal(loc: WorkLocation) {
    setEditingLocation(loc);
    setLocName(loc.name);
    setLocAddress(loc.address || "");
    setLocLat(loc.latitude != null ? String(loc.latitude) : "");
    setLocLng(loc.longitude != null ? String(loc.longitude) : "");
    setLocError("");
    setShowLocationModal(true);
  }

  async function handleSaveLocation() {
    if (!locName.trim()) {
      setLocError("Location name is required.");
      return;
    }

    // Validate coordinates client-side before sending
    if (locLat && isNaN(Number(locLat))) {
      setLocError("Latitude must be a valid number.");
      return;
    }
    if (locLng && isNaN(Number(locLng))) {
      setLocError("Longitude must be a valid number.");
      return;
    }

    setLocSaving(true);
    setLocError("");

    const payload = {
      name: locName.trim(),
      address: locAddress.trim() || null,
      latitude: locLat ? Number(locLat) : null,
      longitude: locLng ? Number(locLng) : null,
    };

    try {
      const url = editingLocation
        ? `/api/work-locations/${editingLocation.id}`
        : "/api/work-locations";
      const method = editingLocation ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        setLocError(data.error || "Failed to save location.");
        return;
      }

      setShowLocationModal(false);
      fetchLocations();
      setSuccessMsg(editingLocation ? "Location updated." : "Location created.");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch {
      setLocError("Network error.");
    } finally {
      setLocSaving(false);
    }
  }

  // ── Archive location ──
  async function handleArchiveLocation(loc: WorkLocation) {
    if (!confirm(`Archive "${loc.name}"? It will be hidden from the list but not deleted.`)) return;

    try {
      const res = await fetch(`/api/work-locations/${loc.id}`, { method: "DELETE" });
      if (res.ok) fetchLocations();
    } catch {
      // silent
    }
  }

  // ── Get current GPS ──
  function handleGetGPS() {
    if (!navigator.geolocation) {
      setLocError("Geolocation is not supported by your browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocLat(pos.coords.latitude.toFixed(6));
        setLocLng(pos.coords.longitude.toFixed(6));
      },
      () => {
        setLocError("Failed to get GPS coordinates. Check permissions.");
      }
    );
  }

  // ── Open attendance settings ──
  async function openSettings(loc: WorkLocation) {
    setSettingsLocation(loc);
    setSettingsLoading(true);
    setSettingsError("");

    try {
      const res = await fetch(`/api/attendance-settings?locationId=${loc.id}`);
      const data = await res.json();

      if (data && data.id) {
        setSettings(data);
        setSAttRequired(data.attendance_required);
        setSQrRequired(data.qr_required);
        setSQrMode(data.qr_mode);
        setSGpsRequired(data.gps_required);
        setSRadius(data.allowed_radius_metres);
        setSSelfie(data.selfie_required);
        setSSitePhoto(data.site_photo_required);
        setSEarlyCheckin(data.early_checkin_minutes);
        setSLateGrace(data.late_grace_minutes);
        setSEarlyDeparture(data.early_departure_review_minutes);
        setSLateFinish(data.late_finish_review_minutes);
        setSRounding(data.rounding_minutes);
        setSCheckoutMethod(data.checkout_method);
        setSDynamicRefresh(data.dynamic_qr_refresh_seconds);

        // Track configured state
        if (data.attendance_required) {
          setConfiguredLocationIds((prev) => new Set(prev).add(loc.id));
        }
      } else {
        // No settings yet — use defaults
        setSettings(null);
        setSAttRequired(false);
        setSQrRequired(false);
        setSQrMode("STATIC");
        setSGpsRequired(false);
        setSRadius(100);
        setSSelfie(false);
        setSSitePhoto(false);
        setSEarlyCheckin(15);
        setSLateGrace(10);
        setSEarlyDeparture(10);
        setSLateFinish(15);
        setSRounding(0);
        setSCheckoutMethod("BUTTON_ONLY");
        setSDynamicRefresh(60);
      }
    } catch {
      setSettingsError("Failed to load settings.");
    } finally {
      setSettingsLoading(false);
    }
  }

  async function handleSaveSettings() {
    if (!settingsLocation) return;
    setSettingsSaving(true);
    setSettingsError("");

    try {
      const res = await fetch("/api/attendance-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId: settingsLocation.id,
          attendance_required: sAttRequired,
          qr_required: sQrRequired,
          qr_mode: sQrMode,
          gps_required: sGpsRequired,
          allowed_radius_metres: sRadius || 100,
          selfie_required: sSelfie,
          site_photo_required: sSitePhoto,
          early_checkin_minutes: sEarlyCheckin || 0,
          late_grace_minutes: sLateGrace || 0,
          early_departure_review_minutes: sEarlyDeparture || 0,
          late_finish_review_minutes: sLateFinish || 0,
          rounding_minutes: sRounding,
          checkout_method: sCheckoutMethod,
          dynamic_qr_refresh_seconds: sDynamicRefresh || 60,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSettingsError(data.error || "Failed to save settings.");
        return;
      }

      setSettings(data);

      // Track configured state for badges
      if (sAttRequired) {
        setConfiguredLocationIds((prev) => new Set(prev).add(settingsLocation.id));
      } else {
        setConfiguredLocationIds((prev) => {
          const next = new Set(prev);
          next.delete(settingsLocation.id);
          return next;
        });
      }

      setSettingsLocation(null); // close

      // Show success toast
      setSuccessMsg("Attendance settings saved.");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch {
      setSettingsError("Network error.");
    } finally {
      setSettingsSaving(false);
    }
  }

  // ── Toggle helper ──
  function Toggle({
    label,
    checked,
    onChange,
    disabled,
  }: {
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
  }) {
    return (
      <div className="flex items-center justify-between py-2">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={`relative w-11 h-6 rounded-full transition-colors ${
            checked ? "bg-blue-600" : "bg-gray-300"
          } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
              checked ? "translate-x-5" : ""
            }`}
          />
        </button>
      </div>
    );
  }

  // ────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Work Locations</h1>
        <button
          onClick={openCreateModal}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Add Location
        </button>
      </div>

      {/* Success toast */}
      {successMsg && (
        <div className="mb-4 bg-green-50 text-green-700 text-sm p-3 rounded-lg border border-green-200 flex items-center gap-2">
          <span>✓</span> {successMsg}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-12 text-gray-500">Loading locations…</div>
      )}

      {/* Empty */}
      {!loading && locations.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <div className="text-4xl mb-3">📍</div>
          <p className="text-gray-500 mb-4">No work locations yet.</p>
          <button
            onClick={openCreateModal}
            className="text-blue-600 font-medium hover:underline"
          >
            Add your first location →
          </button>
        </div>
      )}

      {/* Location cards */}
      {!loading && locations.length > 0 && (
        <div className="space-y-3">
          {locations.map((loc) => (
            <div
              key={loc.id}
              className="bg-white rounded-xl border border-gray-200 p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900 truncate">{loc.name}</h3>
                    {loc.latitude != null && loc.longitude != null && (
                      <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">
                        GPS
                      </span>
                    )}
                    {configuredLocationIds.has(loc.id) && (
                      <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                        ✓ Attendance
                      </span>
                    )}
                  </div>
                  {loc.address && (
                    <p className="text-sm text-gray-500 mt-0.5 truncate">{loc.address}</p>
                  )}
                  {loc.latitude != null && loc.longitude != null && (
                    <p className="text-xs text-gray-400 mt-0.5 font-mono">
                      {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1 ml-3 shrink-0">
                  <button
                    onClick={() => openSettings(loc)}
                    className="text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-lg font-medium hover:bg-blue-100 transition-colors"
                  >
                    Attendance
                  </button>
                  <button
                    onClick={() => openEditModal(loc)}
                    className="text-xs bg-gray-50 text-gray-600 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-100 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleArchiveLocation(loc)}
                    className="text-xs text-red-500 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    Archive
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── Create / Edit Location Modal ─── */}
      {showLocationModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center">
          <div className="bg-white w-full md:max-w-lg md:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">
                  {editingLocation ? "Edit Location" : "New Location"}
                </h2>
                <button
                  onClick={() => setShowLocationModal(false)}
                  className="text-gray-400 hover:text-gray-600 text-xl"
                >
                  ✕
                </button>
              </div>

              {locError && (
                <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4">
                  {locError}
                </div>
              )}

              {/* Name */}
              <label className="block mb-3">
                <span className="text-sm font-medium text-gray-700">Location Name *</span>
                <input
                  type="text"
                  value={locName}
                  onChange={(e) => setLocName(e.target.value)}
                  placeholder="e.g. Campbelltown Site"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </label>

              {/* Address */}
              <label className="block mb-3">
                <span className="text-sm font-medium text-gray-700">Address</span>
                <input
                  type="text"
                  value={locAddress}
                  onChange={(e) => setLocAddress(e.target.value)}
                  placeholder="Street address (optional)"
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </label>

              {/* GPS Coordinates */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700">GPS Coordinates</span>
                  <button
                    type="button"
                    onClick={handleGetGPS}
                    className="text-xs text-blue-600 font-medium hover:underline"
                  >
                    📍 Use Current Location
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={locLat}
                    onChange={(e) => setLocLat(e.target.value)}
                    placeholder="Latitude"
                    className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                  <input
                    type="text"
                    value={locLng}
                    onChange={(e) => setLocLng(e.target.value)}
                    placeholder="Longitude"
                    className="border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Required for GPS-based attendance verification.
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowLocationModal(false)}
                  className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveLocation}
                  disabled={locSaving}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {locSaving ? "Saving…" : editingLocation ? "Save Changes" : "Create Location"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Attendance Settings Bottom Sheet ─── */}
      {settingsLocation && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center">
          <div className="bg-white w-full md:max-w-lg md:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-5">
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-bold text-gray-900">Attendance Settings</h2>
                <button
                  onClick={() => setSettingsLocation(null)}
                  className="text-gray-400 hover:text-gray-600 text-xl"
                >
                  ✕
                </button>
              </div>
              <p className="text-sm text-gray-500 mb-4">{settingsLocation.name}</p>

              {settingsLoading && (
                <div className="text-center py-8 text-gray-500">Loading settings…</div>
              )}

              {settingsError && (
                <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4">
                  {settingsError}
                </div>
              )}

              {!settingsLoading && (
                <div className="space-y-1">
                  {/* Master toggle */}
                  <div className="border-b border-gray-100 pb-3 mb-3">
                    <Toggle
                      label="Attendance Required"
                      checked={sAttRequired}
                      onChange={setSAttRequired}
                    />
                    {!sAttRequired && (
                      <p className="text-xs text-gray-400 mt-1">
                        Shifts at this location will not require attendance check-in.
                      </p>
                    )}
                  </div>

                  {sAttRequired && (
                    <>
                      {/* QR Verification */}
                      <div className="border-b border-gray-100 pb-3 mb-3">
                        <Toggle
                          label="QR Verification"
                          checked={sQrRequired}
                          onChange={setSQrRequired}
                        />
                        {sQrRequired && (
                          <div className="mt-2">
                            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                              QR Mode
                            </span>
                            <div className="flex gap-2 mt-1.5">
                              <button
                                onClick={() => setSQrMode("STATIC")}
                                className={`flex-1 py-2 text-sm rounded-lg font-medium border transition-colors ${
                                  sQrMode === "STATIC"
                                    ? "border-blue-600 bg-blue-50 text-blue-700"
                                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                                }`}
                              >
                                Static QR
                              </button>
                              <button
                                onClick={() => setSQrMode("DYNAMIC")}
                                className={`flex-1 py-2 text-sm rounded-lg font-medium border transition-colors ${
                                  sQrMode === "DYNAMIC"
                                    ? "border-blue-600 bg-blue-50 text-blue-700"
                                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                                }`}
                              >
                                Dynamic QR
                              </button>
                            </div>
                            {sQrMode === "DYNAMIC" && (
                              <div className="mt-2">
                                <label className="text-xs text-gray-500">
                                  Refresh interval (seconds)
                                </label>
                                <input
                                  type="number"
                                  value={sDynamicRefresh}
                                  onChange={(e) => setSDynamicRefresh(Number(e.target.value))}
                                  min={15}
                                  max={300}
                                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* GPS Verification */}
                      <div className="border-b border-gray-100 pb-3 mb-3">
                        <Toggle
                          label="GPS Verification"
                          checked={sGpsRequired}
                          onChange={setSGpsRequired}
                        />
                        {sGpsRequired && (
                          <div className="mt-2">
                            <label className="text-xs text-gray-500">
                              Allowed Radius (metres)
                            </label>
                            <input
                              type="number"
                              value={sRadius}
                              onChange={(e) => setSRadius(Number(e.target.value))}
                              min={10}
                              max={5000}
                              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                            {!settingsLocation.latitude && (
                              <p className="text-xs text-amber-600 mt-1">
                                ⚠ This location has no GPS coordinates set. Edit the location to add them.
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Photo Verification */}
                      <div className="border-b border-gray-100 pb-3 mb-3">
                        <Toggle
                          label="Live Selfie"
                          checked={sSelfie}
                          onChange={setSSelfie}
                        />
                        <Toggle
                          label="Site Photo"
                          checked={sSitePhoto}
                          onChange={setSSitePhoto}
                        />
                      </div>

                      {/* Time Thresholds */}
                      <div className="border-b border-gray-100 pb-3 mb-3">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Time Thresholds
                        </span>
                        <div className="grid grid-cols-2 gap-3 mt-2">
                          <label className="block">
                            <span className="text-xs text-gray-500">Early Check-In (min)</span>
                            <input
                              type="number"
                              value={sEarlyCheckin}
                              onChange={(e) => setSEarlyCheckin(Number(e.target.value))}
                              min={0}
                              max={120}
                              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                          </label>
                          <label className="block">
                            <span className="text-xs text-gray-500">Late Grace (min)</span>
                            <input
                              type="number"
                              value={sLateGrace}
                              onChange={(e) => setSLateGrace(Number(e.target.value))}
                              min={0}
                              max={60}
                              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                          </label>
                          <label className="block">
                            <span className="text-xs text-gray-500">Early Departure (min)</span>
                            <input
                              type="number"
                              value={sEarlyDeparture}
                              onChange={(e) => setSEarlyDeparture(Number(e.target.value))}
                              min={0}
                              max={60}
                              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                          </label>
                          <label className="block">
                            <span className="text-xs text-gray-500">Late Finish (min)</span>
                            <input
                              type="number"
                              value={sLateFinish}
                              onChange={(e) => setSLateFinish(Number(e.target.value))}
                              min={0}
                              max={60}
                              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                            />
                          </label>
                        </div>
                      </div>

                      {/* Time Rounding */}
                      <div className="border-b border-gray-100 pb-3 mb-3">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Time Rounding
                        </span>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {[0, 5, 10, 15, 30].map((val) => (
                            <button
                              key={val}
                              onClick={() => setSRounding(val)}
                              className={`px-3 py-1.5 text-sm rounded-lg font-medium border transition-colors ${
                                sRounding === val
                                  ? "border-blue-600 bg-blue-50 text-blue-700"
                                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
                              }`}
                            >
                              {val === 0 ? "None" : `${val} min`}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Checkout Method */}
                      <div className="pb-3 mb-3">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Checkout Verification
                        </span>
                        <div className="space-y-2 mt-2">
                          {[
                            { value: "BUTTON_ONLY", label: "Button Only" },
                            { value: "GPS_ONLY", label: "GPS Only" },
                            { value: "QR_GPS", label: "QR + GPS" },
                            { value: "QR_GPS_SELFIE", label: "QR + GPS + Selfie" },
                          ].map((opt) => (
                            <button
                              key={opt.value}
                              onClick={() => setSCheckoutMethod(opt.value)}
                              className={`w-full text-left px-3 py-2.5 text-sm rounded-lg border transition-colors ${
                                sCheckoutMethod === opt.value
                                  ? "border-blue-600 bg-blue-50 text-blue-700 font-medium"
                                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Save */}
                  <div className="flex gap-3 pt-3 border-t border-gray-100">
                    <button
                      onClick={() => setSettingsLocation(null)}
                      className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveSettings}
                      disabled={settingsSaving}
                      className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                      {settingsSaving ? "Saving…" : "Save Settings"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
