"use client";

import { Fragment, useEffect, useState } from "react";
import { ApiError, fetchJson } from "@/lib/api-client";
import { LoadErrorNotice } from "@/components/LoadErrorNotice";
import { Toast } from "@/components/Toast";
import { WalkInOrderForm } from "@/components/WalkInOrderForm";
import { formatDate, formatPrice } from "@/lib/utils";
import type { Order, OrderItem, EventDate } from "@/lib/types";
import { diningStyleLabel } from "@/lib/tax";

interface OrderWithItems extends Order {
  order_items: OrderItem[];
  event_date: EventDate;
}

const paymentStatusLabels: Record<string, { label: string; cls: string }> = {
  pending: { label: "未決済", cls: "bg-amber-100 text-amber-700" },
  paid: { label: "決済済み", cls: "bg-emerald-100 text-emerald-700" },
  failed: { label: "失敗", cls: "bg-red-100 text-red-700" },
  refunded: { label: "返金済み", cls: "bg-slate-200 text-slate-600" },
};

const orderStatusLabels: Record<string, { label: string; cls: string }> = {
  temporary: { label: "仮予約", cls: "bg-amber-100 text-amber-700" },
  confirmed: { label: "確定", cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "キャンセル", cls: "bg-red-100 text-red-700" },
};

const sourceLabels: Record<string, { label: string; cls: string }> = {
  online: { label: "予約", cls: "bg-indigo-50 text-indigo-700" },
  walk_in: { label: "店頭", cls: "bg-orange-100 text-orange-700" },
};

/** Rows drawn before the operator asks for more. */
const PAGE_SIZE = 100;

const pickupStatusLabels: Record<string, { label: string; cls: string }> = {
  not_picked_up: { label: "未受取", cls: "bg-slate-100 text-slate-600" },
  picked_up: { label: "受取済", cls: "bg-emerald-100 text-emerald-700" },
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<OrderWithItems[]>([]);
  const [eventDates, setEventDates] = useState<EventDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [csvDownloading, setCsvDownloading] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  /** キャンセルを取り消している最中の注文。 */
  const [restoringId, setRestoringId] = useState<string | null>(null);
  /** お支払い状況を直している最中の注文。 */
  const [payingId, setPayingId] = useState<string | null>(null);
  /** 受取ステータスを書き換え中の注文。二度押しを止めるためだけに持ちます。 */
  const [pickingId, setPickingId] = useState<string | null>(null);
  /** 確認メールを再送中の注文。 */
  const [resendingId, setResendingId] = useState<string | null>(null);

  // Filters
  const [filterDate, setFilterDate] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSearch, setFilterSearch] = useState("");

  /**
   * How many rows are on the screen at once.
   *
   * Searching and filtering still run over every order — it is only the
   * drawing that is held back. A full run of this event is around a
   * thousand orders, and putting a thousand rows into the page at once is
   * what makes the shop's phone crawl on the day it is busiest.
   */
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    loadOrders();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [orders, filterDate, filterStatus, filterSearch]);

  async function loadOrders() {
    setLoadError("");
    try {
      const data = await fetchJson<{
        dates: EventDate[];
        orders: OrderWithItems[];
      }>("/api/admin/orders");

      setEventDates(data.dates);
      setOrders(data.orders);
    } catch (err) {
      console.error("Orders load error:", err);
      setLoadError(
        err instanceof ApiError ? err.message : "サーバーとの通信に失敗しました"
      );
    } finally {
      setLoading(false);
    }
  }

  function applyFilters() {
    setVisibleCount(PAGE_SIZE);
    let result = [...orders];

    if (filterDate) {
      result = result.filter((o) => o.event_date_id === filterDate);
    }
    if (filterStatus) {
      result = result.filter((o) => o.order_status === filterStatus);
    }
    if (filterSearch) {
      const q = filterSearch.toLowerCase();
      result = result.filter(
        (o) =>
          o.customer_name.toLowerCase().includes(q) ||
          o.order_number.toLowerCase().includes(q) ||
          o.customer_email.toLowerCase().includes(q) ||
          o.customer_phone.includes(q)
      );
    }

    setFilteredOrders(result);
  }

  async function handleCancel(order: OrderWithItems) {
    const ok = window.confirm(
      [
        `${order.customer_name} 様の注文 ${order.order_number} をキャンセルします。`,
        "",
        "押さえていた在庫は受付枠に戻ります。",
        ...(order.square_payment_id
          ? [
              "",
              "※ 返金はこの画面では行われません。",
              "　 Square の管理画面から手動で返金してください。",
            ]
          : []),
        "",
        "押し間違えたときは、このあと「キャンセルを取り消す」で戻せます。",
        "（ただし、他の方のご予約が入って在庫が無くなっていると戻せません）",
        "",
        "よろしいですか？",
      ].join("\n")
    );
    if (!ok) return;

    setCancellingId(order.id);
    try {
      await fetchJson(`/api/admin/orders/${order.id}/cancel`, {
        method: "PATCH",
      });
      await loadOrders();
    } catch (err) {
      console.error("Cancel error:", err);
      alert(
        err instanceof ApiError ? err.message : "キャンセル処理に失敗しました"
      );
    } finally {
      setCancellingId(null);
    }
  }

  async function handleRestore(order: OrderWithItems) {
    const ok = window.confirm(
      [
        `${order.customer_name} 様の注文 ${order.order_number} のキャンセルを取り消します。`,
        "",
        "受付枠から在庫を取り直します。",
        "他の方のご予約で埋まっていた場合は戻せません（その場合は何も変わりません）。",
        ...(order.square_payment_id
          ? [
              "",
              "※ Square で既に返金をお済ませの場合、お金は戻りません。",
              "　 この画面では「決済済み」の表示に戻りますので、",
              "　 Square 側と食い違わないかご確認ください。",
            ]
          : []),
        "",
        "よろしいですか？",
      ].join("\n")
    );
    if (!ok) return;

    setRestoringId(order.id);
    try {
      await fetchJson(`/api/admin/orders/${order.id}/restore`, {
        method: "PATCH",
      });
      await loadOrders();
    } catch (err) {
      console.error("Restore error:", err);
      /*
        在庫が足りないときは、どの商品がいくつ足りないかまで返ってきます。
        「戻せません」だけだと、お店は次に何をすればよいか分かりません。
      */
      const details =
        err instanceof ApiError && Array.isArray(err.details) ? err.details : [];
      alert(
        [
          err instanceof ApiError
            ? err.message
            : "キャンセルの取り消しに失敗しました",
          ...details,
        ].join("\n")
      );
    } finally {
      setRestoringId(null);
    }
  }

  /**
   * 店頭販売のお支払い状況を直す。
   *
   * 直すのはこちらの帳簿だけで、お金は動きません。ネット予約は Square が
   * お金を持っているので、サーバー側で断られます。
   */
  async function handlePaymentStatus(
    order: OrderWithItems,
    next: "paid" | "pending"
  ) {
    const ok = window.confirm(
      next === "paid"
        ? `${order.order_number} を「決済済み」にします。よろしいですか？`
        : [
            `${order.order_number} を「未決済」に戻します。`,
            "",
            "※ お金は動きません。実際に返金する場合は別途お願いします。",
            "",
            "よろしいですか？",
          ].join("\n")
    );
    if (!ok) return;

    setPayingId(order.id);
    try {
      await fetchJson(`/api/admin/orders/${order.id}/payment-status`, {
        method: "PATCH",
        body: JSON.stringify({ payment_status: next }),
      });
      await loadOrders();
    } catch (err) {
      console.error("Payment status error:", err);
      alert(
        err instanceof ApiError
          ? err.message
          : "お支払い状況の変更に失敗しました"
      );
    } finally {
      setPayingId(null);
    }
  }

  /**
   * 渡したか、まだか。
   *
   * 「受取管理」にも同じ操作がありますが、当日はこの一覧を開いたまま
   * 進めることが多く、渡すたびに画面を移るのは現実的ではありません。
   * 押したところを書き換えるだけで、読み込み直しはしません——行が
   * 並び替わると、次にどれを押すつもりだったか分からなくなります。
   *
   * 確認は出しません。取り違えてもすぐ戻せますし、カウンターでは
   * 一度の操作で終わるほうが大事です。
   */
  async function handlePickupStatus(
    order: OrderWithItems,
    next: "picked_up" | "not_picked_up"
  ) {
    setPickingId(order.id);
    try {
      await fetchJson(`/api/admin/orders/${order.id}/pickup`, {
        method: "PATCH",
        body: JSON.stringify({ pickup_status: next }),
      });
      // 絞り込みは `orders` から引き直されるので、元の配列だけ直せば足ります。
      setOrders((list) =>
        list.map((o) => (o.id === order.id ? { ...o, pickup_status: next } : o))
      );
    } catch (err) {
      console.error("Pickup update error:", err);
      alert(
        err instanceof ApiError
          ? err.message
          : "受取ステータスの変更に失敗しました"
      );
    } finally {
      setPickingId(null);
    }
  }

  /**
   * 確認メールをもう一度送る。
   *
   * 配信事業者の1日の上限に当たった日、予約は通るのに確認メールだけが
   * 出ませんでした。電話で1件ずつ注文番号をお伝えするしかなかったので、
   * 押せば済むようにします。
   *
   * 送り終えたら一覧を読み直します。「メール未送信」の印はその注文の
   * 最後の記録で決まるので、届いた時点で消えます。消えることが、
   * どれがまだ終わっていないかの目印になります。
   */
  async function handleResendMail(order: OrderWithItems) {
    const ok = window.confirm(
      [
        `${order.customer_name} 様（${order.customer_email}）に`,
        "確認メールをもう一度送ります。",
        "",
        "よろしいですか？",
      ].join("\n")
    );
    if (!ok) return;

    setResendingId(order.id);
    try {
      await fetchJson(`/api/admin/orders/${order.id}/resend-mail`, {
        method: "POST",
      });
      setMessage({ text: "確認メールを再送しました", ok: true });
      await loadOrders();
    } catch (err) {
      console.error("Resend mail error:", err);
      alert(
        err instanceof ApiError
          ? err.message
          : "確認メールの再送に失敗しました"
      );
    } finally {
      setResendingId(null);
    }
  }

  async function handleCSVDownload() {
    setCsvDownloading(true);
    try {
      const res = await fetch("/api/admin/orders/csv");
      if (!res.ok) throw new Error("CSV download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
      a.download = `orders_${dateStr}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("CSV download error:", err);
      alert("CSVダウンロードに失敗しました");
    } finally {
      setCsvDownloading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">読み込み中...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <LoadErrorNotice
        message={loadError}
        onRetry={() => {
          setLoading(true);
          loadOrders();
        }}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">注文一覧</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">{filteredOrders.length} 件</span>
          <button
            onClick={handleCSVDownload}
            disabled={csvDownloading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {csvDownloading ? "ダウンロード中..." : "CSV一括ダウンロード"}
          </button>
        </div>
      </div>

      <Toast message={message} />

      <WalkInOrderForm
        dates={eventDates}
        onCreated={(text) => {
          setMessage({ text, ok: true });
          setTimeout(() => setMessage(null), 4000);
          loadOrders();
        }}
      />

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <label className="block text-xs text-slate-500 mb-1">名前・注文番号で検索</label>
            <input
              type="text"
              placeholder="検索..."
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">受取日</label>
            <select
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none"
            >
              <option value="">すべて</option>
              {eventDates.map((d) => (
                <option key={d.id} value={d.id}>
                  {formatDate(d.pickup_date)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">注文ステータス</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none"
            >
              <option value="">すべて</option>
              <option value="temporary">仮予約</option>
              <option value="confirmed">確定</option>
              <option value="cancelled">キャンセル</option>
            </select>
          </div>
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {/*
                  折り返してよいのは商品の列だけ。ほかを詰めると、見出しも札も
                  一文字ずつ縦に割れて読めなくなります。幅が足りないときは、
                  商品がその分を引き受けて折り返します（w-full がその役）。
                */}
                <th className="whitespace-nowrap text-left px-4 py-3 font-medium text-slate-500">注文番号</th>
                <th className="whitespace-nowrap text-left px-4 py-3 font-medium text-slate-500">お客様名</th>
                <th className="whitespace-nowrap text-left px-4 py-3 font-medium text-slate-500">受取日</th>
                <th className="w-full text-left px-4 py-3 font-medium text-slate-500">商品</th>
                <th className="whitespace-nowrap text-right px-4 py-3 font-medium text-slate-500">金額</th>
                <th className="whitespace-nowrap text-center px-4 py-3 font-medium text-slate-500">決済</th>
                <th className="whitespace-nowrap text-center px-4 py-3 font-medium text-slate-500">注文</th>
                <th className="whitespace-nowrap text-center px-4 py-3 font-medium text-slate-500">受取</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.slice(0, visibleCount).map((order) => {
                const payment = paymentStatusLabels[order.payment_status] || { label: order.payment_status, cls: "bg-slate-100 text-slate-600" };
                const orderSt = orderStatusLabels[order.order_status] || { label: order.order_status, cls: "bg-slate-100 text-slate-600" };
                const pickup = pickupStatusLabels[order.pickup_status] || { label: order.pickup_status, cls: "bg-slate-100 text-slate-600" };
                const isExpanded = expandedId === order.id;

                return (
                  <Fragment key={order.id}>
                    <tr
                      className={`border-t border-slate-100 cursor-pointer transition-colors ${
                        isExpanded ? "bg-indigo-50/50" : "hover:bg-slate-50"
                      }`}
                      onClick={() => setExpandedId(isExpanded ? null : order.id)}
                    >
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">
                        {order.order_number}
                        {order.source === "walk_in" && (
                          <span
                            className={`ml-2 whitespace-nowrap rounded px-1.5 py-0.5 font-sans text-[10px] font-medium ${sourceLabels.walk_in.cls}`}
                          >
                            {sourceLabels.walk_in.label}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-800 font-medium">
                        {order.customer_name}
                        {/*
                          確認メールが届いていないお客様。気づかないままだと、
                          当日「予約した覚えがあるのにメールが無い」になります。
                        */}
                        {order.confirmation_mail_failed && (
                          <span
                            title="確認メールを送信できませんでした。お電話などでご連絡ください"
                            className="ml-2 whitespace-nowrap rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700"
                          >
                            メール未送信
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        {order.event_date
                          ? formatDate(order.event_date.pickup_date)
                          : "-"}
                        <span
                          className={`mt-0.5 inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${
                            order.dining_style === "eat_in"
                              ? "bg-rose-100 text-rose-700"
                              : "bg-sky-100 text-sky-700"
                          }`}
                        >
                          {diningStyleLabel(order.dining_style)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {order.order_items?.map((item) => (
                          <span key={item.id} className="inline-block mr-2">
                            {item.product_name_snapshot} x{item.quantity}
                          </span>
                        ))}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-slate-800 font-medium">
                        {formatPrice(order.total_amount)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-center">
                        <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${payment.cls}`}>
                          {payment.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-center">
                        <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${orderSt.cls}`}>
                          {orderSt.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-center">
                        <span className={`inline-block whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium ${pickup.cls}`}>
                          {pickup.label}
                        </span>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-indigo-50/30">
                        <td colSpan={8} className="px-4 py-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div className="space-y-1">
                              <p className="text-slate-500">
                                メール: <span className="text-slate-700">{order.customer_email}</span>
                              </p>
                              <p className="text-slate-500">
                                電話: <span className="text-slate-700">{order.customer_phone}</span>
                              </p>
                              <p className="text-slate-500">
                                支払方法:{" "}
                                <span className="text-slate-700">
                                  {order.payment_method === "cash"
                                    ? "現地払い"
                                    : "クレジットカード"}
                                </span>
                              </p>
                              {order.square_payment_id && (
                                <p className="text-slate-500">
                                  Square決済ID:{" "}
                                  <span className="font-mono text-xs text-slate-700">
                                    {order.square_payment_id}
                                  </span>
                                  {order.square_receipt_url && (
                                    <a
                                      href={order.square_receipt_url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="ml-2 text-indigo-600 underline underline-offset-2"
                                    >
                                      レシート
                                    </a>
                                  )}
                                </p>
                              )}
                              <p className="text-slate-500">
                                注文日時:{" "}
                                <span className="text-slate-700">
                                  {new Date(order.created_at).toLocaleString("ja-JP")}
                                </span>
                              </p>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-slate-500 mb-2">注文明細</p>
                              <div className="space-y-1">
                                {order.order_items?.map((item) => (
                                  <div key={item.id} className="flex justify-between">
                                    <span className="text-slate-700">
                                      {item.product_name_snapshot} x{item.quantity}
                                    </span>
                                    <span className="text-slate-700">{formatPrice(item.subtotal)}</span>
                                  </div>
                                ))}
                                <div className="border-t border-slate-200 pt-1 mt-1 flex justify-between font-medium">
                                  <span className="text-slate-800">合計</span>
                                  <span className="text-slate-800">{formatPrice(order.total_amount)}</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="mt-4 border-t border-slate-200 pt-3">
                            {order.order_status === "cancelled" ? (
                              <div className="flex flex-wrap items-center gap-3">
                                {/*
                                  押し間違いを戻せるように。無いと、その場で
                                  注文を作り直すことになり、注文番号も決済の
                                  記録も合わなくなります。

                                  決済が通らなかった注文には出しません。戻すと
                                  「お金を受け取っていないのに確定している注文」
                                  ができてしまうためです。
                                */}
                                {!(
                                  order.source === "online" &&
                                  order.payment_status === "pending"
                                ) && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRestore(order);
                                    }}
                                    disabled={restoringId === order.id}
                                    className="rounded-lg border border-indigo-300 bg-white px-4 py-1.5 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-50 disabled:opacity-50"
                                  >
                                    {restoringId === order.id
                                      ? "処理中..."
                                      : "キャンセルを取り消す"}
                                  </button>
                                )}
                                <div className="text-xs text-slate-500">
                                  <p>
                                    この注文はキャンセル済みです。在庫は受付枠に戻っています。
                                  </p>
                                  {order.source === "online" &&
                                    order.payment_status === "pending" && (
                                      <p className="mt-1">
                                        決済が完了しなかったため、戻すことはできません。
                                      </p>
                                    )}
                                  {order.square_payment_id && (
                                    <p className="mt-1 text-amber-700">
                                      返金は Square の管理画面から手動で行ってください（上記の決済IDで検索できます）。
                                    </p>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-3">
                                {/*
                                  渡し終わったものから印を付けていけるように。

                                  ネット予約でも店頭販売でも同じです。当日の
                                  残りが見えていないと、閉店まぎわに「まだ来て
                                  いないのは誰か」を数え直すことになります。
                                */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handlePickupStatus(
                                      order,
                                      order.pickup_status === "picked_up"
                                        ? "not_picked_up"
                                        : "picked_up"
                                    );
                                  }}
                                  disabled={pickingId === order.id}
                                  className="rounded-lg border border-indigo-300 bg-white px-4 py-1.5 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-50 disabled:opacity-50"
                                >
                                  {pickingId === order.id
                                    ? "処理中..."
                                    : order.pickup_status === "picked_up"
                                      ? "「未受取」に戻す"
                                      : "「受取済」にする"}
                                </button>
                                {/*
                                  店頭販売だけ、お支払い状況を直せます。

                                  ネット予約のお金は Square が持っていて、
                                  こちらの表示だけ書き換えると二度と
                                  突き合わせられなくなります。
                                */}
                                {order.source === "walk_in" && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handlePaymentStatus(
                                        order,
                                        order.payment_status === "paid"
                                          ? "pending"
                                          : "paid"
                                      );
                                    }}
                                    disabled={payingId === order.id}
                                    className="rounded-lg border border-emerald-300 bg-white px-4 py-1.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50"
                                  >
                                    {payingId === order.id
                                      ? "処理中..."
                                      : order.payment_status === "paid"
                                        ? "「未決済」に戻す"
                                        : "「決済済み」にする"}
                                  </button>
                                )}
                                {/*
                                  確認メールの再送。

                                  宛先が無い店頭販売には出しません。失敗した
                                  ときだけに絞ってもいません——「届いていない」
                                  とお客様から言われるのは、こちらの記録が
                                  成功になっている場合もあるからです。
                                */}
                                {order.customer_email && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleResendMail(order);
                                    }}
                                    disabled={resendingId === order.id}
                                    className="rounded-lg border border-sky-300 bg-white px-4 py-1.5 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-50 disabled:opacity-50"
                                  >
                                    {resendingId === order.id
                                      ? "送信中..."
                                      : "確認メールを再送"}
                                  </button>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCancel(order);
                                  }}
                                  disabled={cancellingId === order.id}
                                  className="rounded-lg border border-red-300 bg-white px-4 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                                >
                                  {cancellingId === order.id
                                    ? "処理中..."
                                    : "この注文をキャンセル"}
                                </button>
                                <span className="text-xs text-slate-500">
                                  在庫は受付枠に戻ります。押し間違えたときは、
                                  このあと戻せます（在庫が残っていれば）。
                                  {order.square_payment_id &&
                                    " 返金は Square の管理画面から別途お願いします。"}
                                </span>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {filteredOrders.length > visibleCount && (
                <tr>
                  <td colSpan={8} className="px-4 py-4 text-center">
                    <button
                      onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      さらに {Math.min(PAGE_SIZE, filteredOrders.length - visibleCount)} 件表示
                      <span className="ml-2 text-xs text-slate-400">
                        （{visibleCount} / {filteredOrders.length} 件）
                      </span>
                    </button>
                  </td>
                </tr>
              )}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                    注文が見つかりません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
