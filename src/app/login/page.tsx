"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      // Supabase Auth uses email — we store userId as the email identifier
      // (userId@workforce.app) so employees log in with their simple User ID.
      const email = userId.includes("@") ? userId : `${userId}@workforce.app`;

      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError("Invalid User ID or password. Please try again.");
        setLoading(false);
        return;
      }

      // After successful login, redirect — the layout will handle routing
      // based on role and must_change_password flag.
      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        {/* Logo / App name */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Workforce App</h1>
          <p className="text-gray-500 mt-1">Sign in to your account</p>
        </div>

        {/* Login form */}
        <form
          onSubmit={handleLogin}
          className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-4"
        >
          {error && (
            <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3 border border-red-200">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="userId"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              User ID
            </label>
            <input
              id="userId"
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
              autoComplete="username"
              placeholder="Enter your User ID"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder="Enter your password"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-base
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white rounded-lg py-3.5 text-base font-semibold
                       hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500
                       disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
