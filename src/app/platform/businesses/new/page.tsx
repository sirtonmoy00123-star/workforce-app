"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function NewBusinessPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<{ business_name: string; owner_email: string } | null>(null);

  // Business fields
  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [timezone, setTimezone] = useState("Australia/Sydney");

  // Owner fields
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");

  // Auto-generate slug from business name
  function handleNameChange(name: string) {
    setBusinessName(name);
    const autoSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    setSlug(autoSlug);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/platform/businesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business_name: businessName,
          slug,
          email,
          phone,
          address,
          timezone,
          owner_name: ownerName,
          owner_email: ownerEmail,
          owner_password: ownerPassword,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create business.");
        setLoading(false);
        return;
      }

      setSuccess({
        business_name: businessName,
        owner_email: ownerEmail,
      });
    } catch {
      setError("Something went wrong.");
    }

    setLoading(false);
  }

  if (success) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">✅</span>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Business Created!</h2>
          <p className="text-gray-600 mb-4">
            <strong>{success.business_name}</strong> is ready to go.
          </p>
          <div className="bg-gray-50 rounded-lg p-4 text-left text-sm mb-6">
            <div className="font-medium text-gray-700 mb-2">Owner Login Details:</div>
            <div className="text-gray-600">
              <p>Email: <code className="text-gray-900">{success.owner_email}</code></p>
              <p>Password: <code className="text-gray-900">{ownerPassword}</code></p>
            </div>
            <p className="text-amber-600 text-xs mt-2">
              ⚠️ Share these credentials with the business owner securely.
            </p>
          </div>
          <div className="flex gap-3 justify-center">
            <Link
              href="/platform/businesses"
              className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              View All Businesses
            </Link>
            <button
              onClick={() => {
                setSuccess(null);
                setBusinessName("");
                setSlug("");
                setEmail("");
                setPhone("");
                setAddress("");
                setOwnerName("");
                setOwnerEmail("");
                setOwnerPassword("");
              }}
              className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Add Another Business
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-6">
        <Link href="/platform/businesses" className="text-sm text-gray-500 hover:text-gray-700">
          ← Back to Businesses
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mt-2">Add New Business</h1>
        <p className="text-sm text-gray-500 mt-1">
          Create a business and its owner account. The owner can then add employees and manage their workforce.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200">
            {error}
          </div>
        )}

        {/* Business Details */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Business Details</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Business Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => handleNameChange(e.target.value)}
              required
              placeholder="e.g. Smith Cleaning Services"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Slug <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              required
              placeholder="smith-cleaning"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono
                         focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
            <p className="text-xs text-gray-400 mt-1">Used for login and URLs. Lowercase letters, numbers, hyphens only.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Business Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="04XX XXX XXX"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, Sydney NSW 2000"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            >
              <option value="Australia/Sydney">Australia/Sydney (AEST)</option>
              <option value="Australia/Melbourne">Australia/Melbourne (AEST)</option>
              <option value="Australia/Brisbane">Australia/Brisbane (AEST)</option>
              <option value="Australia/Perth">Australia/Perth (AWST)</option>
              <option value="Australia/Adelaide">Australia/Adelaide (ACST)</option>
              <option value="Australia/Darwin">Australia/Darwin (ACST)</option>
              <option value="Australia/Hobart">Australia/Hobart (AEST)</option>
              <option value="Pacific/Auckland">New Zealand (NZST)</option>
            </select>
          </div>
        </div>

        {/* Owner Account */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Owner Account</h2>
          <p className="text-sm text-gray-500">
            This person will be the business owner. They can add admins and employees.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Owner Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              required
              placeholder="John Smith"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Owner Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              required
              placeholder="john@smithcleaning.com.au"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
            <p className="text-xs text-gray-400 mt-1">The owner will use this email to log in.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Temporary Password <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={ownerPassword}
              onChange={(e) => setOwnerPassword(e.target.value)}
              required
              minLength={6}
              placeholder="Min 6 characters"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-emerald-600 text-white rounded-lg py-3 text-sm font-medium
                     hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500
                     disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Creating…" : "Create Business & Owner Account"}
        </button>
      </form>
    </div>
  );
}
