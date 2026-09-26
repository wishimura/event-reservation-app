"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";

const navItems: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/admin", label: "ダッシュボード", icon: "home" },
  { href: "/admin/inventory", label: "在庫管理", icon: "box" },
  { href: "/admin/production", label: "製造計画", icon: "clipboard" },
  { href: "/admin/orders", label: "注文一覧", icon: "list" },
  { href: "/admin/pickup", label: "受取管理", icon: "bag" },
  { href: "/admin/products", label: "商品マスタ", icon: "tag" },
  { href: "/admin/settings", label: "イベント設定", icon: "gear" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  }

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
                <Icon name={item.icon} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-6 py-4 border-t border-indigo-800 space-y-2">
          <Link
            href="/"
            className="block text-xs text-indigo-300 hover:text-white transition-colors"
          >
            &larr; お客様向けサイトへ
          </Link>
          <button
            onClick={handleLogout}
            className="block text-xs text-indigo-300 hover:text-white transition-colors"
          >
            ログアウト
          </button>
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
                  aria-label={item.label}
                  title={item.label}
                  className={`rounded p-2 ${
                    isActive
                      ? "bg-indigo-700 text-white"
                      : "text-indigo-300 hover:text-white"
                  }`}
                >
                  <Icon name={item.icon} label={item.label} />
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
