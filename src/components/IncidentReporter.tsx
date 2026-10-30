"use client";

import { useEffect } from "react";

/**
 * お客様の画面で起きた例外を、お店に知らせる。
 *
 * ## なぜ要るか
 *
 * ここまで、画面が落ちたときに残るものは**何もありませんでした**。お客様には
 * 真っ白な画面か素っ気ないエラーが出て、こちらには一行も届きません。
 * 「買えない」というお申し出の多くはこの形で出ます。
 *
 * ## うるさくしない
 *
 * 1回の読み込みで送るのは数件までにします。同じ内容は1度だけ送ります。
 * 壊れ方によっては毎フレーム例外が出ることがあり、そのまま送ると記録が
 * 埋まって、肝心のものが読めなくなります。
 */

/** 1回の読み込みで送る上限。 */
const MAX_REPORTS = 5;

export function IncidentReporter() {
  useEffect(() => {
    let sent = 0;
    const seen = new Set<string>();

    function report(message: string, detail: Record<string, unknown>) {
      const key = `${message}|${JSON.stringify(detail)}`;
      if (sent >= MAX_REPORTS || seen.has(key)) return;
      seen.add(key);
      sent += 1;

      try {
        void fetch("/api/incident", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            area: "screen",
            stage: "uncaught",
            outcome: "error",
            message: message.slice(0, 500),
            path: window.location.pathname,
            detail,
          }),
        }).catch(() => {});
      } catch {
        /* 記録はおまけ。ここで止めない。 */
      }
    }

    function onError(event: ErrorEvent) {
      report(event.message || "画面でエラーが起きました", {
        source: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: event.error instanceof Error ? event.error.stack?.slice(0, 1200) : null,
      });
    }

    function onRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      report(
        reason instanceof Error
          ? reason.message
          : `処理が失敗しました: ${String(reason)}`,
        {
          kind: "unhandledrejection",
          stack: reason instanceof Error ? reason.stack?.slice(0, 1200) : null,
        }
      );
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
