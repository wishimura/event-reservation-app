"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";

/**
 * 左の帯を畳んだかどうか。
 *
 * タブレットで文字を大きくすると、240px の帯のぶんだけ表が入りきらなく
 * なります。畳めば本文が広がりますが、**開くたびに畳み直すようでは意味が
 * ない**ので、その端末の設定として覚えます。端末ごとの好みなので、
 * サーバーには置きません。
 */
const SIDEBAR_KEY = "admin_sidebar_collapsed";

const navItems: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/admin", label: "ダッシュボード", icon: "home" },
  { href: "/admin/inventory", label: "在庫管理", icon: "box" },
  { href: "/admin/production", label: "製造計画", icon: "clipboard" },
  { href: "/admin/orders", label: "注文一覧", icon: "list" },
  { href: "/admin/pickup", label: "受取管理", icon: "bag" },
  { href: "/admin/products", label: "商品マスタ", icon: "tag" },
  { href: "/admin/settings", label: "イベント設定", icon: "gear" },
  { href: "/admin/incident-logs", label: "調査ログ", icon: "card" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  /*
    最初は開いた状態で描きます。サーバー側では端末の設定を知りようがなく、
    畳んだ状態で描いてから開き直すと画面が跳ねるためです。読み込んだあとで
    合わせます。
  */
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      /*
        端末に覚えてある設定を、描いたあとで一度だけ取り込みます。

        サーバーには端末の設定が無いので、ここでしか読めません。効果の中で
        状態を書くのは本来避けたい形ですが、これは**外にある設定を React 側に
        写す**という、まさにそのための場面です。一度きりで、連鎖もしません。
      */
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem(SIDEBAR_KEY) === "1");
    } catch {
      /* 読めない端末（プライベートモード等）では開いたままでよい。 */
    }
  }, []);

  function toggleSidebar() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        /* 覚えられなくても、この画面のあいだは効く。 */
      }
      return next;
    });
  }

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar */}
      <aside
        className={`${
          collapsed ? "w-16" : "w-60"
        } bg-indigo-900 text-white flex-shrink-0 hidden md:flex flex-col transition-[width] duration-200`}
      >
        <div
          className={`flex items-center border-b border-indigo-800 ${
            collapsed ? "justify-center px-2 py-4" : "justify-between px-6 py-5"
          }`}
        >
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="text-lg font-bold tracking-wide">管理画面</h1>
              <p className="text-xs text-indigo-300 mt-0.5">Event Reservation</p>
            </div>
          )}
          {/*
            畳む・開く。

            畳んでもアイコンは残します。隠しきってしまうと、画面を移るたびに
            開いて選んで畳む、という手間が増えます。
          */}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "メニューを開く" : "メニューを閉じる"}
            title={collapsed ? "メニューを開く" : "メニューを閉じる"}
            className="shrink-0 rounded p-1.5 text-indigo-300 transition-colors hover:bg-indigo-800 hover:text-white"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-5 w-5 transition-transform ${collapsed ? "" : "rotate-180"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
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
                title={item.label}
                className={`flex items-center gap-3 py-3 text-sm transition-colors ${
                  collapsed ? "justify-center px-0" : "px-6"
                } ${
                  isActive
                    ? "bg-indigo-800 text-white font-medium"
                    : "text-indigo-200 hover:bg-indigo-800/50 hover:text-white"
                }`}
              >
                <Icon name={item.icon} label={collapsed ? item.label : undefined} />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </nav>
        {/*
          畳んでいても、ここからは必ず出られるようにしておく。カウンターの
          端末に入りっぱなしになると、お客様全員の連絡先が見える状態が
          続きます。文字が入らないので、畳んだときは短い印にします。
        */}
        <div
          className={`border-t border-indigo-800 py-4 ${
            collapsed ? "flex flex-col items-center gap-3 px-2" : "space-y-2 px-6"
          }`}
        >
          <Link
            href="/"
            title="お客様向けサイトへ"
            className="block text-xs text-indigo-300 hover:text-white transition-colors"
          >
            {collapsed ? <span aria-label="お客様向けサイトへ">&larr;</span> : "← お客様向けサイトへ"}
          </Link>
          <button
            onClick={handleLogout}
            title="ログアウト"
            className="block text-xs text-indigo-300 hover:text-white transition-colors"
          >
            {collapsed ? <span aria-label="ログアウト">出</span> : "ログアウト"}
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 入る項目が増えても横にはみ出さないよう、折り返す。 */}
        <header className="md:hidden flex flex-wrap items-center justify-between gap-y-2 bg-indigo-900 px-4 py-3 text-white">
          <h1 className="text-base font-bold">管理画面</h1>
          {/*
            項目が増えても横にはみ出さないよう、ここも折り返す。
            調査ログを足したときに、アイコン1つぶんで溢れました。
          */}
          <nav className="flex min-w-0 flex-wrap justify-end gap-1">
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
            {/*
              スマホからも必ず出られるようにしておく。カウンターで使う端末に
              入りっぱなしになると、そこからお客様全員の連絡先が見えてしまう。
              横の並びは狭いので、文字は小さくして最後に置く。
            */}
            <button
              onClick={handleLogout}
              className="ml-1 shrink-0 rounded px-2 py-2 text-xs text-indigo-300 transition-colors hover:text-white"
            >
              ログアウト
            </button>
          </nav>
        </header>

        {/* Main content */}
        <main className="flex-1 p-4 md:p-8 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
