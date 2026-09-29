"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, fetchJson } from "@/lib/api-client";
import { Icon } from "@/components/Icon";
import {
  formatDate,
  formatPrice,
  parsePickupTimeSlots,
  todayInJST,
} from "@/lib/utils";
import type { DailyProductInventory, Event, EventDate } from "@/lib/types";

type InventoryRow = DailyProductInventory & { product: NonNullable<DailyProductInventory["product"]> };

/**
 * Writing down a sale made at the counter.
 *
 * Someone turns up without having booked and buys what is left. That comes
 * out of the same day's stock as the reservations, so unless it is recorded
 * the production plan and the remaining counts both drift away from what is
 * actually on the shelf.
 *
 * The money is not handled here — it was taken at the till, in front of the
 * customer. This only writes down what happened.
 */
export function WalkInOrderForm({
  dates,
  onCreated,
}: {
  dates: EventDate[];
  onCreated: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dateId, setDateId] = useState("");
  const [event, setEvent] = useState<Event | null>(null);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [slot, setSlot] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "credit_card">("cash");
  const [handedOver, setHandedOver] = useState(true);

  /** Today if the shop is open today, otherwise the next day still to come. */
  const defaultDateId = useCallback(() => {
    if (dates.length === 0) return "";
    const today = todayInJST();
    return (dates.find((d) => d.pickup_date >= today) ?? dates[dates.length - 1]).id;
  }, [dates]);

  useEffect(() => {
    if (open && !dateId) setDateId(defaultDateId());
  }, [open, dateId, defaultDateId]);

  useEffect(() => {
    if (!open || !dateId) return;

    let cancelled = false;
    setLoading(true);
    setError("");

    fetchJson<{ event: Event; inventory: InventoryRow[] }>(
      `/api/admin/inventory?dateId=${encodeURIComponent(dateId)}`
    )
      .then((data) => {
        if (cancelled) return;
        setEvent(data.event);
        setInventory(data.inventory);
        setQuantities({});
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "商品を読み込めませんでした");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, dateId]);

  const timeSlots = parsePickupTimeSlots(event?.pickup_time_slots);

  const lines = inventory
    .map((inv) => ({ inv, quantity: quantities[inv.product_id] ?? 0 }))
    .filter((l) => l.quantity > 0);

  const total = lines.reduce((sum, l) => sum + l.inv.product.price * l.quantity, 0);

  function setQuantity(row: InventoryRow, next: number) {
    const remaining = Math.max(0, row.production_quantity - row.reserved_quantity);
    const clamped = Math.max(0, Math.min(next, remaining));
    setQuantities((q) => ({ ...q, [row.product_id]: clamped }));
  }

  function reset() {
    setQuantities({});
    setName("");
    setPhone("");
    setEmail("");
    setSlot("");
    setPaymentMethod("cash");
    setHandedOver(true);
    setError("");
  }

  async function handleSubmit() {
    if (lines.length === 0) {
      setError("商品を1つ以上選んでください");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const res = await fetchJson<{ order: { order_number: string; total_amount: number } }>(
        "/api/admin/orders",
        {
          method: "POST",
          body: JSON.stringify({
            event_date_id: dateId,
            customer_name: name,
            customer_email: email,
            customer_phone: phone,
            pickup_time_slot: slot || undefined,
            payment_method: paymentMethod,
            handed_over: handedOver,
            items: lines.map((l) => ({
              product_id: l.inv.product_id,
              quantity: l.quantity,
            })),
          }),
        }
      );

      reset();
      setOpen(false);
      onCreated(
        `店頭販売を登録しました（${res.order.order_number} / ${formatPrice(res.order.total_amount)}）`
      );
    } catch (err) {
      const detail =
        err instanceof ApiError && err.details?.length
          ? err.details.join(" / ")
          : err instanceof ApiError
            ? err.message
            : "登録に失敗しました";
      setError(detail);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
      >
        <Icon name="bag" className="h-4 w-4" />
        店頭販売を登録
      </button>
    );
  }

  const field =
    "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none";
  const label = "block text-xs font-medium text-slate-500 mb-1";

  return (
    <div className="mb-6 rounded-xl border border-indigo-300 bg-white p-4 md:p-5">
      <div className="mb-1 flex items-start justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-800">店頭販売を登録</h3>
        <button
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          閉じる
        </button>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-slate-500">
        ご予約なしで店頭で買われた分を記録します。
        <strong>その日の受付枠がその数だけ減り、製造計画にも反映されます。</strong>
        お支払いはここでは扱いません（レジで受け取り済みの想定です）。確認メールも送りません。
      </p>

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label}>受取日</label>
            <select
              className={field}
              value={dateId}
              onChange={(e) => setDateId(e.target.value)}
            >
              {dates.map((d) => (
                <option key={d.id} value={d.id}>
                  {formatDate(d.pickup_date)}
                  {d.is_active ? "" : "（受付停止中）"}
                </option>
              ))}
            </select>
          </div>
          {timeSlots.length > 0 && (
            <div>
              <label className={label}>受取時間（任意）</label>
              <select className={field} value={slot} onChange={(e) => setSlot(e.target.value)}>
                <option value="">指定なし</option>
                {timeSlots.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* 商品 */}
        <div>
          <label className={label}>商品と数量</label>
          {loading ? (
            <p className="py-6 text-center text-sm text-slate-400">読み込み中...</p>
          ) : inventory.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">
              この受取日には商品が登録されていません
            </p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {inventory.map((inv) => {
                const remaining = Math.max(
                  0,
                  inv.production_quantity - inv.reserved_quantity
                );
                const quantity = quantities[inv.product_id] ?? 0;

                return (
                  <div key={inv.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {inv.product.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {formatPrice(inv.product.price)}
                        <span className={remaining === 0 ? "ml-2 text-red-500" : "ml-2"}>
                          残り {remaining} 個
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        aria-label={`${inv.product.name} を1つ減らす`}
                        onClick={() => setQuantity(inv, quantity - 1)}
                        disabled={quantity === 0}
                        className="h-8 w-8 rounded-full bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-40"
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm font-bold tabular-nums text-slate-800">
                        {quantity}
                      </span>
                      <button
                        type="button"
                        aria-label={`${inv.product.name} を1つ増やす`}
                        onClick={() => setQuantity(inv, quantity + 1)}
                        disabled={quantity >= remaining}
                        title={quantity >= remaining ? "受付枠がありません" : undefined}
                        className="h-8 w-8 rounded-full bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400"
                      >
                        ＋
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className={label}>お客様名（任意）</label>
            <input
              className={field}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="店頭のお客様"
            />
          </div>
          <div>
            <label className={label}>電話番号（任意）</label>
            <input
              className={field}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
            />
          </div>
          <div>
            <label className={label}>メール（任意）</label>
            <input className={field} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={label}>お支払い方法</label>
            <select
              className={field}
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as "cash" | "credit_card")}
            >
              <option value="cash">現地払い（現金など）</option>
              <option value="credit_card">クレジットカード</option>
            </select>
          </div>
          <label className="flex items-start gap-2 self-end rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={handedOver}
              onChange={(e) => setHandedOver(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              その場でお渡し済み
              <span className="block text-xs text-slate-400">
                外すと「未受取」で登録され、受取管理に残ります
              </span>
            </span>
          </label>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className="text-sm text-slate-600">
            合計 <span className="text-lg font-bold text-slate-800">{formatPrice(total)}</span>
            <span className="ml-2 text-xs text-slate-400">
              {lines.reduce((n, l) => n + l.quantity, 0)} 点
            </span>
          </p>
          <button
            onClick={handleSubmit}
            disabled={saving || lines.length === 0}
            className="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "登録中..." : "この内容で登録"}
          </button>
        </div>
      </div>
    </div>
  );
}
