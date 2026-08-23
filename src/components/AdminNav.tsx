"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

const navLinks = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/admin/employees", label: "Employees" },
  { href: "/admin/locations", label: "Locations" },
  { href: "/admin/roster", label: "Roster" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/timesheets", label: "Timesheets" },
  { href: "/admin/payments", label: "Payments" },
];

export default function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 md:px-6 flex items-center justify-between h-14">
        {/* Brand */}
        <Link href="/admin/dashboard" className="font-bold text-lg text-blue-600">
          Workforce
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => {
            const isActive = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                  isActive
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Logout + mobile toggle */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleLogout}
            className="hidden md:block text-sm text-gray-500 hover:text-gray-700"
          >
            Sign Out
          </button>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden p-2 text-gray-500 hover:text-gray-700"
            aria-label="Toggle menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {menuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <nav className="md:hidden border-t border-gray-100 bg-white px-4 pb-3 pt-1">
          {navLinks.map((link) => {
            const isActive = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className={`block px-3 py-3 text-base rounded-lg my-0.5 ${
                  isActive
                    ? "bg-blue-50 text-blue-700 font-medium"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <button
            onClick={handleLogout}
            className="block w-full text-left px-3 py-3 text-base text-red-600 hover:bg-red-50 rounded-lg mt-1"
          >
            Sign Out
          </button>
        </nav>
      )}
    </header>
  );
}
