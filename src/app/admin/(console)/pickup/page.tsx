"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, fetchJson } from "@/lib/api-client";
import { LoadErrorNotice } from "@/components/LoadErrorNotice";
import { groupByCustomer, matchedByLabel } from "@/lib/customer-grouping";
import { diningStyleLabel } from "@/lib/tax";
import { formatPrice } from "@/lib/utils";
import type { DiningStyle, Order, OrderItem } from "@/lib/types";

interface PickupOrder extends Order {
  order_items: OrderItem[];
}

export default function PickupPage() {
  const [orders, setOrders] = useState<PickupOrder[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    loadTodayOrders();
  }, []);

  /**
   * 同じ方の注文をひとまとめにする。まとめるのはメールアドレスか電話番号が
   * 一致したときだけで、氏名ではまとめない（同姓同名の取り違えを防ぐため）。
   */
  const groups = useMemo(() => groupByCustomer(orders), [orders]);

  /**
   * 検索は1件でも当たれば、その方のまとまりごと表示する。
   *
   * お客様が完了メールを1枚だけ見せてこられたとき、その番号で引けば
   * 「他にも2件ありますよ」がその場で分かるようにするため。
   */
  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;

    return groups.filter((group) =>
      group.orders.some(
        (o) =>
          o.customer_name.toLowerCase().includes(q) ||
          o.order_number.toLowerCase().includes(q) ||
          o.customer_phone.includes(q) ||
          o.customer_email.toLowerCase().includes(q)
      )
    );
  }, [groups, search]);

  async function loadTodayOrders() {
    setLoadError("");
    try {
      const data = await fetchJson<{ orders: PickupOrder[] }>(
        "/api/admin/pickup"
      );
      setOrders(data.orders);
    } catch (err) {
      console.error("Pickup load error:", err);
      setLoadError(
        err instanceof ApiError ? err.message : "サーバーとの通信に失敗しました"
      );
    } finally {
      setLoading(false);
    }
  }

  async function setPickupStatus(
    orderId: string,
    status: "picked_up" | "not_picked_up"
  ) {
    setUpdatingId(orderId);
    try {
      await fetchJson(`/api/admin/orders/${orderId}/pickup`, {
        method: "PATCH",
        body: JSON.stringify({ pickup_status: status }),
      });

      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, pickup_status: status } : o))
      );
    } catch (err) {
      console.error("Pickup update error:", err);
      alert("受取ステータスの更新に失敗しました");
    } finally {
      setUpdatingId(null);
    }
  }

  const markPickedUp = (orderId: string) =>
    setPickupStatus(orderId, "picked_up");

  const markNotPickedUp = (orderId: string) =>
    setPickupStatus(orderId, "not_picked_up");

  /** まとまりの残りをまとめてお渡し済みにする。 */
  async function markGroupPickedUp(groupOrders: PickupOrder[]) {
    const remaining = groupOrders.filter(
      (o) => o.pickup_status !== "picked_up"
    );
    for (const order of remaining) {
      await setPickupStatus(order.id, "picked_up");
    }
  }

  /**
   * カウンターで店内／持ち帰りを切り替える。
   *
   * 消費税率は「お渡しした時点」の意思で決まるので、ここで直したものが正。
   * 売値は同じなので、決済済みでも金額は動かない。
   */
  async function changeDiningStyle(orderId: string, next: DiningStyle) {
    setUpdatingId(orderId);
    try {
      await fetchJson(`/api/admin/orders/${orderId}/dining-style`, {
        method: "PATCH",
        body: JSON.stringify({ dining_style: next }),
      });

      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, dining_style: next } : o))
      );
    } catch (err) {
      console.error("Dining style update error:", err);
      alert(
        err instanceof ApiError
          ? err.message
          : "お召し上がり方法の変更に失敗しました"
      );
    } finally {
      setUpdatingId(null);
    }
  }

  const totalCount = orders.length;
  const pickedUpCount = orders.filter((o) => o.pickup_status === "picked_up").length;
  const remainingCount = totalCount - pickedUpCount;

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
          loadTodayOrders();
        }}
      />
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-6">本日の受取管理</h2>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
          <p className="text-xs text-slate-500">合計</p>
          <p className="text-2xl font-bold text-slate-800">{totalCount}</p>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 text-center">
          <p className="text-xs text-emerald-600">受取済み</p>
          <p className="text-2xl font-bold text-emerald-700">{pickedUpCount}</p>
        </div>
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 text-center">
          <p className="text-xs text-amber-600">残り</p>
          <p className="text-2xl font-bold text-amber-700">{remainingCount}</p>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="名前・注文番号・電話番号で検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none"
        />
      </div>

      {/* Progress bar */}
      {totalCount > 0 && (
        <div className="mb-6">
          <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${(pickedUpCount / totalCount) * 100}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-1 text-right">
            {Math.round((pickedUpCount / totalCount) * 100)}% 完了
          </p>
        </div>
      )}

      {/* まとまりごとの一覧 */}
      <div className="space-y-3">
        {visibleGroups.map((group) => {
          const groupOrders = group.orders;
          const done = groupOrders.filter(
            (o) => o.pickup_status === "picked_up"
          ).length;
          const allDone = done === groupOrders.length;
          const remaining = groupOrders.length - done;
          const groupTotal = groupOrders.reduce(
            (sum, o) => sum + o.total_amount,
            0
          );
          const groupItems = groupOrders.reduce(
            (sum, o) =>
              sum +
              (o.order_items ?? []).reduce((n, item) => n + item.quantity, 0),
            0
          );
          const head = groupOrders[0];
          const multiple = groupOrders.length > 1;

          return (
            <div
              key={group.key}
              className={`rounded-xl border bg-white transition-all ${
                allDone ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200"
              }`}
            >
              {/* お客様 */}
              <div className="border-b border-slate-100 px-4 pt-4 pb-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-lg font-bold text-slate-800">
                    {head.customer_name}
                  </span>
                  {multiple && (
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700">
                      {groupOrders.length}件まとめ
                    </span>
                  )}
                  <span
                    className={`ml-auto text-sm font-medium ${
                      allDone ? "text-emerald-700" : "text-amber-700"
                    }`}
                  >
                    {done}/{groupOrders.length} 受取済
                  </span>
                </div>

                <p className="mt-1 text-xs text-slate-500">
                  {head.customer_email}
                  {head.customer_phone ? ` ・ ${head.customer_phone}` : ""}
                </p>

                {/*
                  まとめた理由をその場に書く。黙ってまとめるのがいちばん危ない。
                  スタッフが「なぜ一緒になっているのか」を一目で判断できること。
                */}
                {multiple && (
                  <p className="mt-0.5 text-xs text-indigo-600">
                    └ {matchedByLabel(group.matchedBy)}
                  </p>
                )}

                {/*
                  同姓同名の別の方がいる場合の警告。連絡先が違えば別人として
                  扱うので、取り違えを防げるのはこの一行だけ。
                */}
                {group.hasNameCollision && (
                  <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                    ⚠ 同じ「{head.customer_name}」様が他にもいらっしゃいます。
                    連絡先が異なるため、別の方として表示しています。注文番号をご確認ください。
                  </p>
                )}
              </div>

              {/* 注文（まとめても1件ずつ見せる） */}
              <div className="divide-y divide-slate-100">
                {groupOrders.map((order) => {
                  const isPickedUp = order.pickup_status === "picked_up";
                  const busy = updatingId === order.id;

                  return (
                    <div
                      key={order.id}
                      className="flex flex-wrap items-start gap-3 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-slate-500">
                            {order.order_number}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                              order.dining_style === "eat_in"
                                ? "bg-rose-100 text-rose-700"
                                : "bg-sky-100 text-sky-700"
                            }`}
                          >
                            {diningStyleLabel(order.dining_style)}
                          </span>
                          {isPickedUp && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                              受取済
                            </span>
                          )}
                        </div>

                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {order.order_items?.map((item) => (
                            <span
                              key={item.id}
                              className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700"
                            >
                              {item.product_name_snapshot} x{item.quantity}
                            </span>
                          ))}
                        </div>

                        <p className="mt-1.5 text-sm font-medium text-slate-700">
                          {formatPrice(order.total_amount)}
                          <span className="ml-2 text-xs font-normal text-slate-400">
                            ({order.payment_method === "cash" ? "現地払い" : "カード"}{" "}
                            / {order.payment_status === "paid" ? "決済済み" : "未決済"})
                          </span>
                        </p>

                        {/*
                          当日の切り替え。売値は変わらないので、決済済みでも
                          押せる。渡したあとでも直せるようにしてある。
                        */}
                        <button
                          onClick={() =>
                            changeDiningStyle(
                              order.id,
                              order.dining_style === "eat_in" ? "takeout" : "eat_in"
                            )
                          }
                          disabled={busy}
                          className="mt-1.5 text-xs font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-800 disabled:opacity-50"
                        >
                          {order.dining_style === "eat_in"
                            ? "テイクアウトに変更"
                            : "イートインに変更"}
                        </button>
                      </div>

                      <div className="shrink-0">
                        {isPickedUp ? (
                          <button
                            onClick={() => markNotPickedUp(order.id)}
                            disabled={busy}
                            className="rounded-lg bg-slate-200 px-4 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-300 disabled:opacity-50"
                          >
                            {busy ? "..." : "取消"}
                          </button>
                        ) : (
                          <button
                            onClick={() => markPickedUp(order.id)}
                            disabled={busy}
                            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {busy ? "処理中..." : "受取完了"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* まとめ */}
              {multiple && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
                  <p className="text-sm text-slate-600">
                    合計 {groupItems} 点
                    <span className="ml-2 font-bold text-slate-800">
                      {formatPrice(groupTotal)}
                    </span>
                  </p>
                  {remaining > 0 && (
                    <button
                      onClick={() => markGroupPickedUp(groupOrders)}
                      disabled={updatingId !== null}
                      className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
                    >
                      残り{remaining}件をまとめて受取完了
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {visibleGroups.length === 0 && (
          <div className="text-center py-12 text-slate-400">
            {orders.length === 0
              ? "本日の受取予約はありません"
              : "該当する注文が見つかりません"}
          </div>
        )}
      </div>
    </div>
  );
}
