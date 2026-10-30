"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, fetchJson } from "@/lib/api-client";
import { LoadErrorNotice } from "@/components/LoadErrorNotice";

interface PaymentLog {
  id: string;
  created_at: string;
  source: string;
  stage: string;
  outcome: string;
  order_number: string | null;
  amount: number | null;
  customer_email: string | null;
  message: string;
  detail: unknown;
  user_agent: string | null;
}

/** どの段階で転んだか。お店の言葉に直す。 */
const STAGE_LABELS: Record<string, string> = {
  card_form: "カード入力欄",
  tokenize: "カード情報の確認",
  verify: "本人認証（3Dセキュア）",
  submit: "注文の送信",
  charge: "カードへの請求",
  record: "結果の記録",
};

const OUTCOME_LABELS: Record<string, { label: string; cls: string }> = {
  ok: { label: "成功", cls: "bg-emerald-100 text-emerald-700" },
  declined: { label: "断られた", cls: "bg-amber-100 text-amber-800" },
  error: { label: "エラー", cls: "bg-red-100 text-red-700" },
  abandoned: { label: "途中でやめた", cls: "bg-slate-200 text-slate-600" },
};

export default function PaymentLogsPage() {
  const [logs, setLogs] = useState<PaymentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [onlyTrouble, setOnlyTrouble] = useState(false);

  const load = useCallback(async () => {
    setLoadError("");
    setLoading(true);
    try {
      const data = await fetchJson<{ logs: PaymentLog[] }>(
        "/api/admin/payment-logs"
      );
      setLogs(data.logs);
    } catch (err) {
      console.error("Payment log load error:", err);
      setLoadError(
        err instanceof ApiError ? err.message : "サーバーとの通信に失敗しました"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = onlyTrouble ? logs.filter((l) => l.outcome !== "ok") : logs;

  function formatTime(value: string): string {
    return new Date(value).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">決済ログ</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            決済までにどこで転んだかの記録です。
            <strong className="text-slate-700">
              カード入力欄が出なかった、情報の確認で止まった
            </strong>
            といった、サーバーに注文が届かない失敗もここに残ります。
            お申し出があったときは、その時刻のあたりを見てください。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={onlyTrouble}
              onChange={(e) => setOnlyTrouble(e.target.checked)}
              className="h-4 w-4"
            />
            うまくいかなかったものだけ
          </label>
          <button
            onClick={load}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
          >
            再読み込み
          </button>
        </div>
      </div>

      {loadError && (
        <div className="mb-6">
          <LoadErrorNotice message={loadError} onRetry={load} />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-4 py-3 text-left font-medium text-slate-500">
                  日時
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">
                  どこで
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">
                  結果
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">
                  内容
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-500">
                  注文・ご連絡先
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((log) => {
                const outcome =
                  OUTCOME_LABELS[log.outcome] ?? {
                    label: log.outcome,
                    cls: "bg-slate-100 text-slate-600",
                  };
                return (
                  <tr key={log.id} className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                      {formatTime(log.created_at)}
                    </td>
                    <td className="px-4 py-3 text-slate-800">
                      {STAGE_LABELS[log.stage] ?? log.stage}
                      <span className="ml-2 text-xs text-slate-400">
                        {log.source === "browser" ? "お客様の端末" : "サーバー"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${outcome.cls}`}
                      >
                        {outcome.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {log.message}
                      {log.detail != null && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-slate-400">
                            詳細
                          </summary>
                          <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-[11px] text-slate-600">
                            {JSON.stringify(log.detail, null, 2)}
                          </pre>
                        </details>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {log.order_number && (
                        <div className="font-mono">{log.order_number}</div>
                      )}
                      {log.amount != null && <div>¥{log.amount.toLocaleString()}</div>}
                      {log.customer_email && <div>{log.customer_email}</div>}
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-sm text-slate-400">
                    {loading ? "読み込み中..." : "記録はまだありません"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-slate-400">
        お客様の端末から届いた記録は申告であって、証拠ではありません。
        お金のことを確かめるときは、Square の明細と注文一覧を正としてください。
      </p>
    </div>
  );
}
