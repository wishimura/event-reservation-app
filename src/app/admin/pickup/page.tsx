"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatPrice } from "@/lib/utils";
import type { Order, OrderItem } from "@/lib/types";

interface PickupOrder extends Order {
  order_items: OrderItem[];
}

export default function PickupPage() {
  const [orders, setOrders] = useState<PickupOrder[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<PickupOrder[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    loadTodayOrders();
  }, []);

  useEffect(() => {
    if (!search) {
      setFilteredOrders(orders);
    } else {
      const q = search.toLowerCase();
      setFilteredOrders(
        orders.filter(
          (o) =>
            o.customer_name.toLowerCase().includes(q) ||
            o.order_number.toLowerCase().includes(q) ||
            o.customer_phone.includes(q)
        )
      );
    }
  }, [orders, search]);

  async function loadTodayOrders() {
    try {
      const { data: ev } = await supabase
        .from("events")
        .select("*")
        .eq("is_active", true)
        .single();
      if (!ev) return;

      const today = new Date().toISOString().split("T")[0];

      // Find today's event_date
      const { data: todayDate } = await supabase
        .from("event_dates")
        .select("*")
        .eq("event_id", ev.id)
        .eq("pickup_date", today)
        .single();

      if (!todayDate) {
        setLoading(false);
        return;
      }

      const { data } = await supabase
        .from("orders")
        .select("*, order_items(*, product:products(*))")
        .eq("event_date_id", todayDate.id)
        .eq("order_status", "confirmed")
        .order("customer_name");

      if (data) setOrders(data as PickupOrder[]);
    } catch (err) {
      console.error("Pickup load error:", err);
    } finally {
      setLoading(false);
    }
  }

  async function markPickedUp(orderId: string) {
    setUpdatingId(orderId);
    try {
      await supabase
        .from("orders")
        .update({ pickup_status: "picked_up" })
        .eq("id", orderId);

      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, pickup_status: "picked_up" as const } : o
        )
      );
    } catch (err) {
      console.error("Pickup update error:", err);
    } finally {
      setUpdatingId(null);
    }
  }

  async function markNotPickedUp(orderId: string) {
    setUpdatingId(orderId);
    try {
      await supabase
        .from("orders")
        .update({ pickup_status: "not_picked_up" })
        .eq("id", orderId);

      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId ? { ...o, pickup_status: "not_picked_up" as const } : o
        )
      );
    } catch (err) {
      console.error("Pickup update error:", err);
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

      {/* Orders List */}
      <div className="space-y-3">
        {filteredOrders.map((order) => {
          const isPickedUp = order.pickup_status === "picked_up";
          return (
            <div
              key={order.id}
              className={`bg-white rounded-xl border p-4 transition-all ${
                isPickedUp
                  ? "border-emerald-200 bg-emerald-50/30"
                  : "border-slate-200"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-bold text-slate-800 text-lg">
                      {order.customer_name}
                    </span>
                    {isPickedUp && (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full font-medium">
                        受取済
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 font-mono">{order.order_number}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {order.order_items?.map((item) => (
                      <span
                        key={item.id}
                        className="inline-flex items-center bg-slate-100 text-slate-700 text-xs px-2 py-1 rounded-md"
                      >
                        {item.product_name_snapshot} x{item.quantity}
                      </span>
                    ))}
                  </div>
                  <p className="text-sm font-medium text-slate-700 mt-2">
                    {formatPrice(order.total_amount)}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      ({order.payment_method === "cash" ? "現金" : "カード"} /{" "}
                      {order.payment_status === "paid" ? "決済済み" : "未決済"})
                    </span>
                  </p>
                </div>

                <div className="flex-shrink-0">
                  {isPickedUp ? (
                    <button
                      onClick={() => markNotPickedUp(order.id)}
                      disabled={updatingId === order.id}
                      className="px-4 py-2 text-sm bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300 transition-colors disabled:opacity-50"
                    >
                      {updatingId === order.id ? "..." : "取消"}
                    </button>
                  ) : (
                    <button
                      onClick={() => markPickedUp(order.id)}
                      disabled={updatingId === order.id}
                      className="px-6 py-3 text-sm font-bold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-sm"
                    >
                      {updatingId === order.id ? "処理中..." : "受取完了"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {filteredOrders.length === 0 && (
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
