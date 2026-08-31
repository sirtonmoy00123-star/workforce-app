"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/admin/dashboard", icon: "🏠", label: "Dashboard" },
  { href: "/admin/roster", icon: "📅", label: "Shifts" },
  { href: "/admin/employees", icon: "👥", label: "Employees" },
  { href: "/admin/payments", icon: "💲", label: "Payments" },
];

export default function AdminBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 md:hidden z-40">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors ${
                active ? "text-blue-600" : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <span className="text-xl">{tab.icon}</span>
              <span className={`text-[10px] font-semibold ${active ? "text-blue-600" : "text-gray-400"}`}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
