"use client";

import { useEffect } from "react";

/**
 * 土台ごと落ちたときの最後の受け皿。
 *
 * `error.tsx` が受け止められない場所（レイアウト自体）で落ちるとここに来ます。
 * 自前の <html> を返す必要があるため、画面は素のままです。
 */
export default function GlobalError({
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
          message: error.message || "画面全体の表示に失敗しました",
          path: typeof window === "undefined" ? null : window.location.pathname,
          detail: { digest: error.digest, global: true },
        }),
      }).catch(() => {});
    } catch {
      /* 記録はおまけ。画面は出す。 */
    }
  }, [error]);

  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#faf8f3",
          color: "#27272a",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: "360px", textAlign: "center" }}>
          <h1 style={{ fontSize: "18px" }}>画面を表示できませんでした</h1>
          <p style={{ fontSize: "14px", lineHeight: 1.8 }}>
            ご迷惑をおかけします。もう一度お試しください。
            <br />
            ご予約がお済みの場合、この表示でご予約が取り消されることはありません。
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "16px",
              padding: "12px 24px",
              borderRadius: "14px",
              border: "none",
              background: "#2f7676",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 700,
            }}
          >
            もう一度読み込む
          </button>
        </div>
      </body>
    </html>
  );
}
