"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 管理画面の「よろしいですか？」を、アプリ自身が描く確認パネル。
 *
 * **`window.confirm` をやめた理由は、現場で実際に詰まったからです。**
 *
 * 2026年11月21日、お店から「キャンセルボタンが押せない」と連絡が来ました。
 * 調べると、注文はまったく手つかず（`confirmed` / `paid`）で、サーバーには
 * リクエストが1件も届いていませんでした。ボタンは壊れていません。
 * `window.confirm()` が端末側で抑止されていて、即座に false を返していた
 * ので、`if (!ok) return;` でそのまま終わっていたのです。
 *
 * ブラウザのダイアログは「出してください」とお願いするものでしかなく、
 * 出すかどうかは端末が決めます。アプリ内ブラウザ（LINE や Instagram の
 * リンクから開いた画面）や、「このページではダイアログを表示しない」に
 * 一度チェックを入れた端末では出ません。そして出なかったことを
 * アプリから知る方法はありません。押した人には「無反応」としか見えず、
 * 取り消しのきかない操作が黙って無視されます。
 *
 * ここで描けば、端末の種類にも設定にも左右されません。テストからも
 * 確かめられます（ダイアログは Playwright からは本物の画面に見えないので、
 * 承認する処理を書いた分だけ素通りしていました）。
 *
 * 逃げ道は「いいえ」側にそろえてあります。背景を押しても Esc を押しても
 * 取り消しで、開いた直後に当たっているのも「いいえ」です。誤って Enter を
 * 叩いたときに消えるのが注文では困るからです。
 */
export interface ConfirmRequest {
  /** パネルの見出し。何が起きるのかを一行で。 */
  title: string;
  /** 本文。空文字を挟むと一行空きます。 */
  lines: string[];
  /** 実行する側のボタンの文字。「はい」ではなく、やることを書く。 */
  confirmLabel: string;
  /** 取り消しのきかない操作は "danger"。既定は "danger"。 */
  tone?: "danger" | "normal";
}

interface Pending {
  request: ConfirmRequest;
  resolve: (ok: boolean) => void;
}

/**
 * `const ok = await confirm({...})` と書けるようにします。
 *
 * `window.confirm` と同じ形にしてあるのは、呼ぶ側を書き換えずに差し替える
 * ためです（`await` が付くだけ）。戻り値の `dialog` を画面のどこかに
 * 置いてください。
 */
export function useConfirm(): {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  dialog: React.ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);

  /**
   * 開いたまま画面を離れたときに、待っている処理を宙づりにしない。
   *
   * 解決されない Promise は `await` の先をずっと止めるので、「処理中...」の
   * ままボタンが戻らなくなります。離れるときは「いいえ」と同じ扱いにします。
   */
  const pendingRef = useRef<Pending | null>(null);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(() => {
    return () => pendingRef.current?.resolve(false);
  }, []);

  const confirm = useCallback((request: ConfirmRequest) => {
    return new Promise<boolean>((resolve) => {
      setPending({ request, resolve });
    });
  }, []);

  const answer = useCallback((ok: boolean) => {
    setPending((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  return {
    confirm,
    dialog: <ConfirmDialog pending={pending} onAnswer={answer} />,
  };
}

function ConfirmDialog({
  pending,
  onAnswer,
}: {
  pending: Pending | null;
  onAnswer: (ok: boolean) => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // 開いたら「いいえ」に当てる。Esc でも閉じる。
  useEffect(() => {
    if (!pending) return;
    cancelRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onAnswer(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pending, onAnswer]);

  if (!pending) return null;

  const { title, lines, confirmLabel, tone = "danger" } = pending.request;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      // 背景を押したら取り消し。パネルの中の click は下で止めます。
      onClick={() => onAnswer(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
      >
        <h2
          id="confirm-dialog-title"
          className="text-base font-bold text-slate-900"
        >
          {title}
        </h2>

        <div className="mt-3 space-y-1 text-sm text-slate-600">
          {lines.map((line, i) =>
            line === "" ? (
              <div key={i} className="h-2" aria-hidden="true" />
            ) : (
              <p key={i}>{line}</p>
            )
          )}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onAnswer(false)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            やめる
          </button>
          <button
            type="button"
            onClick={() => onAnswer(true)}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors ${
              tone === "danger"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
