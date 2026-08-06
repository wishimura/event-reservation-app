"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || submitting) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "ログインに失敗しました");
        return;
      }

      const next = searchParams.get("next");
      // Only allow same-origin relative paths, never an absolute URL.
      const target = next && next.startsWith("/") && !next.startsWith("//")
        ? next
        : "/admin";
      router.replace(target);
      router.refresh();
    } catch {
      setError("通信に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-slate-600 mb-1.5"
        >
          パスワード
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting || !password}
        className="w-full rounded-lg bg-indigo-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-800 disabled:opacity-50"
      >
        {submitting ? "確認中..." : "ログイン"}
      </button>
    </form>
  );
}

export default function AdminLoginPage() {
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-slate-800">管理画面</h1>
          <p className="text-xs text-slate-500 mt-1">Event Reservation</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <Suspense
            fallback={<div className="text-sm text-slate-400">読み込み中...</div>}
          >
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
