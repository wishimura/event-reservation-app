"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/admin", label: "ダッシュボード", icon: "📊" },
  { href: "/admin/inventory", label: "在庫管理", icon: "📦" },
  { href: "/admin/production", label: "製造計画", icon: "🍳" },
  { href: "/admin/orders", label: "注文一覧", icon: "📋" },
  { href: "/admin/pickup", label: "受取管理", icon: "🛒" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside className="w-60 bg-indigo-900 text-white flex-shrink-0 hidden md:flex flex-col">
        <div className="px-6 py-5 border-b border-indigo-800">
          <h1 className="text-lg font-bold tracking-wide">管理画面</h1>
          <p className="text-xs text-indigo-300 mt-0.5">Event Reservation</p>
        </div>
        <nav className="flex-1 py-4">
          {navItems.map((item) => {
            const isActive =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-6 py-3 text-sm transition-colors ${
                  isActive
                    ? "bg-indigo-800 text-white font-medium"
                    : "text-indigo-200 hover:bg-indigo-800/50 hover:text-white"
                }`}
              >
                <span className="text-base">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-6 py-4 border-t border-indigo-800">
          <Link
            href="/"
            className="text-xs text-indigo-300 hover:text-white transition-colors"
          >
            &larr; お客様向けサイトへ
          </Link>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden bg-indigo-900 text-white px-4 py-3 flex items-center justify-between">
          <h1 className="text-base font-bold">管理画面</h1>
          <nav className="flex gap-1">
            {navItems.map((item) => {
              const isActive =
                item.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-2 py-1 rounded text-xs ${
                    isActive
                      ? "bg-indigo-700 text-white"
                      : "text-indigo-300 hover:text-white"
                  }`}
                >
                  {item.icon}
                </Link>
              );
            })}
          </nav>
        </header>

        {/* Main content */}
        <main className="flex-1 p-4 md:p-8 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
