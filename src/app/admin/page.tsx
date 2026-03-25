"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { formatDate, formatPrice, getRemainingQuantity } from "@/lib/utils";
import type { Event, EventDate, Order, DailyProductInventory } from "@/lib/types";

interface DailySummary {
  date: string;
  dateLabel: string;
  orderCount: number;
  totalAmount: number;
}

export default function AdminDashboard() {
  const [event, setEvent] = useState<Event | null>(null);
  const [todayPickupCount, setTodayPickupCount] = useState(0);
  const [todayPickedUp, setTodayPickedUp] = useState(0);
  const [tomorrowReservationCount, setTomorrowReservationCount] = useState(0);
  const [totalSales, setTotalSales] = useState(0);
  const [lowStockItems, setLowStockItems] = useState<DailyProductInventory[]>([]);
  const [dailySummary, setDailySummary] = useState<DailySummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    try {
      // Get active event
      const { data: ev } = await supabase
        .from("events")
        .select("*")
        .eq("is_active", true)
        .single();
      if (!ev) return;
      setEvent(ev);

      // Get all event dates
      const { data: dates } = await supabase
        .from("event_dates")
        .select("*")
        .eq("event_id", ev.id)
        .order("pickup_date");

      // Get all orders
      const { data: orders } = await supabase
        .from("orders")
        .select("*, event_date:event_dates(*)")
        .eq("event_id", ev.id)
        .in("order_status", ["confirmed", "temporary"]);

      const today = new Date().toISOString().split("T")[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

      if (orders) {
        // Today's pickup
        const todayOrders = orders.filter(
          (o: Order) => o.event_date?.pickup_date === today && o.order_status === "confirmed"
        );
        setTodayPickupCount(todayOrders.length);
        setTodayPickedUp(todayOrders.filter((o: Order) => o.pickup_status === "picked_up").length);

        // Tomorrow's reservations
        const tomorrowOrders = orders.filter(
          (o: Order) => o.event_date?.pickup_date === tomorrow
        );
        setTomorrowReservationCount(tomorrowOrders.length);

        // Total sales
        const sales = orders
          .filter((o: Order) => o.payment_status === "paid")
          .reduce((sum: number, o: Order) => sum + o.total_amount, 0);
        setTotalSales(sales);

        // Daily summary
        if (dates) {
          const summary: DailySummary[] = dates.map((d: EventDate) => {
            const dateOrders = orders.filter((o: Order) => o.event_date_id === d.id);
            return {
              date: d.pickup_date,
              dateLabel: formatDate(d.pickup_date),
              orderCount: dateOrders.length,
              totalAmount: dateOrders.reduce((s: number, o: Order) => s + o.total_amount, 0),
            };
          });
          setDailySummary(summary);
        }
      }

      // Low stock warnings - check all upcoming dates
      if (dates) {
        const upcomingDates = dates.filter((d: EventDate) => d.pickup_date >= today);
        const allLowStock: DailyProductInventory[] = [];

        for (const d of upcomingDates) {
          const { data: inv } = await supabase
            .from("daily_product_inventory")
            .select("*, product:products(*)")
            .eq("event_date_id", d.id);
          if (inv) {
            const low = inv.filter(
              (i: DailyProductInventory) =>
                !i.is_sold_out &&
                !i.is_hidden &&
                getRemainingQuantity(i) <= i.warning_threshold &&
                getRemainingQuantity(i) > 0
            );
            allLowStock.push(...low);
          }
        }
        setLowStockItems(allLowStock);
      }
    } catch (err) {
      console.error("Dashboard load error:", err);
    } finally {
      setLoading(false);
    }
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
      <h2 className="text-2xl font-bold text-slate-800 mb-6">ダッシュボード</h2>

      {event && (
        <p className="text-sm text-slate-500 mb-6">
          イベント: <span className="font-medium text-slate-700">{event.name}</span>
        </p>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Link href="/admin/pickup" className="block">
          <div className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow">
            <p className="text-xs text-slate-500 mb-1">本日の受取</p>
            <p className="text-3xl font-bold text-indigo-600">
              {todayPickedUp}
              <span className="text-lg text-slate-400 font-normal"> / {todayPickupCount}</span>
            </p>
            <p className="text-xs text-slate-400 mt-1">件 受取済み</p>
          </div>
        </Link>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-500 mb-1">明日の予約数</p>
          <p className="text-3xl font-bold text-slate-800">{tomorrowReservationCount}</p>
          <p className="text-xs text-slate-400 mt-1">件</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-500 mb-1">総売上</p>
          <p className="text-3xl font-bold text-emerald-600">{formatPrice(totalSales)}</p>
          <p className="text-xs text-slate-400 mt-1">決済済み</p>
        </div>

        <Link href="/admin/inventory" className="block">
          <div className={`bg-white rounded-xl border p-5 hover:shadow-md transition-shadow ${
            lowStockItems.length > 0 ? "border-amber-300 bg-amber-50" : "border-slate-200"
          }`}>
            <p className="text-xs text-slate-500 mb-1">在庫アラート</p>
            <p className={`text-3xl font-bold ${lowStockItems.length > 0 ? "text-amber-600" : "text-slate-400"}`}>
              {lowStockItems.length}
            </p>
            <p className="text-xs text-slate-400 mt-1">件 残りわずか</p>
          </div>
        </Link>
      </div>

      {/* Low Stock Warnings */}
      {lowStockItems.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-8">
          <h3 className="text-sm font-bold text-amber-800 mb-3">在庫アラート</h3>
          <div className="space-y-2">
            {lowStockItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <span className="text-amber-900">{item.product?.name}</span>
                <span className="text-amber-700 font-medium">
                  残り {getRemainingQuantity(item)} / {item.production_quantity}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily Summary Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-700">日別予約サマリー</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="text-left px-5 py-3 font-medium text-slate-500">受取日</th>
                <th className="text-right px-5 py-3 font-medium text-slate-500">予約数</th>
                <th className="text-right px-5 py-3 font-medium text-slate-500">金額</th>
              </tr>
            </thead>
            <tbody>
              {dailySummary.map((row) => (
                <tr key={row.date} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-3 text-slate-700">{row.dateLabel}</td>
                  <td className="px-5 py-3 text-right text-slate-700">{row.orderCount} 件</td>
                  <td className="px-5 py-3 text-right text-slate-700">{formatPrice(row.totalAmount)}</td>
                </tr>
              ))}
              {dailySummary.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-8 text-center text-slate-400">
                    データがありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Quick Links */}
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Link
          href="/admin/inventory"
          className="bg-indigo-600 text-white rounded-xl p-5 text-center hover:bg-indigo-700 transition-colors"
        >
          <p className="font-bold">在庫管理</p>
          <p className="text-xs text-indigo-200 mt-1">製造数・在庫の設定</p>
        </Link>
        <Link
          href="/admin/orders"
          className="bg-white border border-slate-200 rounded-xl p-5 text-center hover:shadow-md transition-shadow"
        >
          <p className="font-bold text-slate-700">注文一覧</p>
          <p className="text-xs text-slate-400 mt-1">全注文の確認・管理</p>
        </Link>
        <Link
          href="/admin/pickup"
          className="bg-white border border-slate-200 rounded-xl p-5 text-center hover:shadow-md transition-shadow"
        >
          <p className="font-bold text-slate-700">受取管理</p>
          <p className="text-xs text-slate-400 mt-1">本日の受取処理</p>
        </Link>
      </div>
    </div>
  );
}
