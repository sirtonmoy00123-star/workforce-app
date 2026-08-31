"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ProfileData {
  full_name: string;
  employee_number: string;
  phone: string | null;
  hourly_rate: number;
  mileage_rate: number;
  employment_status: string;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/profile")
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) setProfile(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading…</div>;
  if (!profile) return <div className="text-center py-12 text-gray-500">Could not load profile.</div>;

  return (
    <div className="max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Profile</h1>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="text-center mb-4">
          <div className="w-20 h-20 bg-blue-100 rounded-full mx-auto flex items-center justify-center text-3xl font-bold text-blue-600 mb-2">
            {profile.full_name.charAt(0)}
          </div>
          <h2 className="text-xl font-bold text-gray-900">{profile.full_name}</h2>
          <p className="text-sm text-gray-500">{profile.employee_number}</p>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-500">Phone</span>
            <span className="font-medium">{profile.phone || "Not set"}</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-500">Hourly Rate</span>
            <span className="font-medium">${profile.hourly_rate.toFixed(2)}/hr</span>
          </div>
          <div className="flex justify-between py-2 border-b border-gray-100">
            <span className="text-gray-500">Mileage Rate</span>
            <span className="font-medium">${profile.mileage_rate.toFixed(2)}/km</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-gray-500">Status</span>
            <span className={`font-medium ${profile.employment_status === "active" ? "text-green-600" : "text-gray-400"}`}>
              {profile.employment_status.charAt(0).toUpperCase() + profile.employment_status.slice(1)}
            </span>
          </div>
        </div>
      </div>

      {/* Storage Management */}
      <Link
        href="/employee/photos"
        className="mt-4 block bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center text-xl">📸</div>
            <div>
              <div className="text-sm font-semibold text-gray-900">Manage My Photos</div>
              <div className="text-xs text-gray-400">View & delete old shift photos</div>
            </div>
          </div>
          <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </Link>
    </div>
  );
}
