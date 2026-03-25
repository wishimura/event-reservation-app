"use client";

import { Fragment, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatDate, formatPrice } from "@/lib/utils";
import type { Order, OrderItem, EventDate } from "@/lib/types";

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

const pickupStatusLabels: Record<string, { label: string; cls: string }> = {
  not_picked_up: { label: "未受取", cls: "bg-slate-100 text-slate-600" },
  picked_up: { label: "受取済", cls: "bg-emerald-100 text-emerald-700" },
  absent: { label: "未来店", cls: "bg-red-100 text-red-700" },
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<OrderWithItems[]>([]);
  const [eventDates, setEventDates] = useState<EventDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [filterDate, setFilterDate] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSearch, setFilterSearch] = useState("");

  useEffect(() => {
    loadOrders();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [orders, filterDate, filterStatus, filterSearch]);

  async function loadOrders() {
    try {
      const { data: ev } = await supabase
        .from("events")
        .select("*")
        .eq("is_active", true)
        .single();
      if (!ev) return;

      const { data: dates } = await supabase
        .from("event_dates")
        .select("*")
        .eq("event_id", ev.id)
        .order("pickup_date");
      if (dates) setEventDates(dates);

      const { data } = await supabase
        .from("orders")
        .select("*, event_date:event_dates(*), order_items(*, product:products(*))")
        .eq("event_id", ev.id)
        .order("created_at", { ascending: false });

      if (data) setOrders(data as OrderWithItems[]);
    } catch (err) {
      console.error("Orders load error:", err);
    } finally {
      setLoading(false);
    }
  }

  function applyFilters() {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">読み込み中...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-slate-800">注文一覧</h2>
        <span className="text-sm text-slate-500">{filteredOrders.length} 件</span>
      </div>

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
                <th className="text-left px-4 py-3 font-medium text-slate-500">注文番号</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">お客様名</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">受取日</th>
                <th className="text-left px-4 py-3 font-medium text-slate-500">商品</th>
                <th className="text-right px-4 py-3 font-medium text-slate-500">金額</th>
                <th className="text-center px-4 py-3 font-medium text-slate-500">決済</th>
                <th className="text-center px-4 py-3 font-medium text-slate-500">注文</th>
                <th className="text-center px-4 py-3 font-medium text-slate-500">受取</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => {
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
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {order.order_number}
                      </td>
                      <td className="px-4 py-3 text-slate-800 font-medium">{order.customer_name}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {order.event_date ? formatDate(order.event_date.pickup_date) : "-"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {order.order_items?.map((item) => (
                          <span key={item.id} className="inline-block mr-2">
                            {item.product_name_snapshot} x{item.quantity}
                          </span>
                        ))}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-800 font-medium">
                        {formatPrice(order.total_amount)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${payment.cls}`}>
                          {payment.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${orderSt.cls}`}>
                          {orderSt.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${pickup.cls}`}>
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
                                  {order.payment_method === "cash" ? "現金" : "クレジットカード"}
                                </span>
                              </p>
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
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
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
