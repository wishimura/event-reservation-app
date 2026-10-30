"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * 画面の描画中に落ちたときに出る画面。
 *
 * ここまで、落ちると Next の既定の画面が出るだけで、**こちらには何も届いて
 * いませんでした**。お客様は買えず、お店は気づけない。いちばん避けたい形です。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      void fetch("/api/incident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          area: "screen",
          stage: "render",
          outcome: "error",
          message: error.message || "画面の表示に失敗しました",
          path: typeof window === "undefined" ? null : window.location.pathname,
          detail: { digest: error.digest, stack: error.stack?.slice(0, 1200) },
        }),
      }).catch(() => {});
    } catch {
      /* 記録はおまけ。画面は出す。 */
    }
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-lg font-bold text-zinc-800">
          画面を表示できませんでした
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600">
          ご迷惑をおかけします。もう一度お試しいただくか、
          しばらく経ってからお越しください。
          <br />
          ご予約がお済みの場合、この表示でご予約が取り消されることはありません。
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <button
            onClick={reset}
            className="rounded-2xl bg-brand-600 py-3 text-sm font-bold text-white transition-colors hover:bg-brand-700"
          >
            もう一度読み込む
          </button>
          <Link
            href="/"
            className="rounded-2xl border border-zinc-200 bg-white py-3 text-sm font-semibold text-zinc-700 transition-colors hover:bg-paper"
          >
            最初の画面に戻る
          </Link>
        </div>
      </div>
    </main>
  );
}
