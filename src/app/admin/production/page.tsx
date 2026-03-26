"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatDate, formatPrice } from "@/lib/utils";
import type { EventDate, DailyProductInventory } from "@/lib/types";

interface InventoryWithProduct extends DailyProductInventory {
  product: { id: string; name: string; price: number; sort_order: number };
}

export default function ProductionPage() {
  const [eventDates, setEventDates] = useState<EventDate[]>([]);
  const [selectedDateId, setSelectedDateId] = useState<string>("");
  const [inventories, setInventories] = useState<InventoryWithProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"single" | "all">("all");

  useEffect(() => {
    loadDates();
  }, []);

  useEffect(() => {
    if (selectedDateId) {
      loadInventory(selectedDateId);
    }
  }, [selectedDateId]);

  async function loadDates() {
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
      .eq("is_active", true)
      .order("pickup_date");

    if (dates && dates.length > 0) {
      setEventDates(dates as EventDate[]);
      setSelectedDateId(dates[0].id);
    }
    setLoading(false);
  }

  async function loadInventory(dateId: string) {
    const { data } = await supabase
      .from("daily_product_inventory")
      .select("*, product:products(*)")
      .eq("event_date_id", dateId)
      .order("product(sort_order)");

    if (data) setInventories(data as InventoryWithProduct[]);
  }

  // Load all dates' inventory for the "all dates" view
  const [allInventories, setAllInventories] = useState<
    Map<string, InventoryWithProduct[]>
  >(new Map());
  const [allLoading, setAllLoading] = useState(false);

  useEffect(() => {
    if (viewMode === "all" && eventDates.length > 0) {
      loadAllInventories();
    }
  }, [viewMode, eventDates]);

  async function loadAllInventories() {
    setAllLoading(true);
    const dateIds = eventDates.map((d) => d.id);
    const { data } = await supabase
      .from("daily_product_inventory")
      .select("*, product:products(*)")
      .in("event_date_id", dateIds)
      .order("product(sort_order)");

    if (data) {
      const map = new Map<string, InventoryWithProduct[]>();
      for (const inv of data as InventoryWithProduct[]) {
        const existing = map.get(inv.event_date_id) || [];
        existing.push(inv);
        map.set(inv.event_date_id, existing);
      }
      setAllInventories(map);
    }
    setAllLoading(false);
  }

  // Get unique product names across all inventories
  const productNames = (() => {
    if (allInventories.size === 0) return [];
    const first = allInventories.values().next().value;
    if (!first) return [];
    return first
      .sort((a: InventoryWithProduct, b: InventoryWithProduct) => a.product.sort_order - b.product.sort_order)
      .map((inv: InventoryWithProduct) => ({
        id: inv.product.id,
        name: inv.product.name,
      }));
  })();

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
        <div>
          <h2 className="text-2xl font-bold text-slate-800">製造指示</h2>
          <p className="text-sm text-slate-500 mt-1">
            日付ごとに何を何個作るか確認できます
          </p>
        </div>
        <div className="flex bg-slate-100 rounded-lg p-1">
          <button
            onClick={() => setViewMode("all")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              viewMode === "all"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            全日程一覧
          </button>
          <button
            onClick={() => setViewMode("single")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              viewMode === "single"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            日別詳細
          </button>
        </div>
      </div>

      {viewMode === "all" ? (
        /* ===== All Dates Overview ===== */
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {allLoading ? (
            <div className="p-12 text-center text-slate-400">読み込み中...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-medium text-slate-500 sticky left-0 bg-slate-50 z-10 min-w-[140px]">
                      商品名
                    </th>
                    {eventDates.map((d) => (
                      <th
                        key={d.id}
                        className="text-center px-3 py-3 font-medium text-slate-500 min-w-[80px]"
                      >
                        <div className="text-xs">{formatDate(d.pickup_date)}</div>
                      </th>
                    ))}
                    <th className="text-center px-4 py-3 font-medium text-slate-500 bg-indigo-50 min-w-[80px]">
                      合計
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {productNames.map((p: { id: string; name: string }) => (
                    <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-medium text-slate-800 sticky left-0 bg-white z-10">
                        {p.name}
                      </td>
                      {eventDates.map((d) => {
                        const inv = allInventories
                          .get(d.id)
                          ?.find((i) => i.product.id === p.id);
                        const qty = inv?.production_quantity ?? 0;
                        const reserved = inv?.reserved_quantity ?? 0;
                        return (
                          <td key={d.id} className="text-center px-3 py-3">
                            <div className="text-slate-800 font-bold text-base">
                              {qty}
                            </div>
                            {reserved > 0 && (
                              <div className="text-xs text-amber-600 mt-0.5">
                                予約{reserved}
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="text-center px-4 py-3 bg-indigo-50/50 font-bold text-indigo-700">
                        {eventDates.reduce((sum, d) => {
                          const inv = allInventories
                            .get(d.id)
                            ?.find((i) => i.product.id === p.id);
                          return sum + (inv?.production_quantity ?? 0);
                        }, 0)}
                      </td>
                    </tr>
                  ))}
                  {/* Total row */}
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                    <td className="px-4 py-3 text-slate-700 sticky left-0 bg-slate-50 z-10">
                      合計
                    </td>
                    {eventDates.map((d) => {
                      const invs = allInventories.get(d.id) || [];
                      const total = invs.reduce(
                        (s, i) => s + i.production_quantity,
                        0
                      );
                      const totalReserved = invs.reduce(
                        (s, i) => s + i.reserved_quantity,
                        0
                      );
                      return (
                        <td key={d.id} className="text-center px-3 py-3">
                          <div className="text-slate-800">{total}</div>
                          {totalReserved > 0 && (
                            <div className="text-xs text-amber-600 mt-0.5">
                              予約{totalReserved}
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="text-center px-4 py-3 bg-indigo-50/50 text-indigo-700">
                      {eventDates.reduce((sum, d) => {
                        const invs = allInventories.get(d.id) || [];
                        return sum + invs.reduce((s, i) => s + i.production_quantity, 0);
                      }, 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* ===== Single Date Detail ===== */
        <>
          {/* Date Selector */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
            <p className="text-xs text-slate-500 mb-3">受取日を選択</p>
            <div className="flex flex-wrap gap-2">
              {eventDates.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDateId(d.id)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                    selectedDateId === d.id
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {formatDate(d.pickup_date)}
                </button>
              ))}
            </div>
          </div>

          {/* Production Detail Cards */}
          <div className="space-y-4">
            {inventories.map((inv) => {
              if (!inv.product) return null;
              const remaining = inv.production_quantity - inv.reserved_quantity;

              return (
                <div
                  key={inv.id}
                  className="bg-white rounded-xl border border-slate-200 p-5"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">
                        {inv.product.name}
                      </h3>
                      <p className="text-sm text-slate-400 mt-0.5">
                        {formatPrice(inv.product.price)} / 個
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-3xl font-bold text-indigo-600">
                        {inv.production_quantity}
                      </div>
                      <div className="text-xs text-slate-400">製造数</div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mb-3">
                    <div className="flex justify-between text-xs text-slate-500 mb-1">
                      <span>予約済 {inv.reserved_quantity} 個</span>
                      <span>残り {Math.max(0, remaining)} 個</span>
                    </div>
                    <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          remaining <= 0
                            ? "bg-red-400"
                            : remaining <= 2
                            ? "bg-amber-400"
                            : "bg-emerald-400"
                        }`}
                        style={{
                          width: `${Math.min(
                            100,
                            (inv.reserved_quantity / inv.production_quantity) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex gap-4 text-sm">
                    <div className="flex-1 bg-slate-50 rounded-lg p-3 text-center">
                      <div className="text-xs text-slate-400 mb-1">製造予定</div>
                      <div className="text-xl font-bold text-slate-800">
                        {inv.production_quantity}
                      </div>
                    </div>
                    <div className="flex-1 bg-amber-50 rounded-lg p-3 text-center">
                      <div className="text-xs text-amber-600 mb-1">予約済</div>
                      <div className="text-xl font-bold text-amber-700">
                        {inv.reserved_quantity}
                      </div>
                    </div>
                    <div
                      className={`flex-1 rounded-lg p-3 text-center ${
                        remaining <= 0
                          ? "bg-red-50"
                          : remaining <= 2
                          ? "bg-amber-50"
                          : "bg-emerald-50"
                      }`}
                    >
                      <div
                        className={`text-xs mb-1 ${
                          remaining <= 0
                            ? "text-red-600"
                            : remaining <= 2
                            ? "text-amber-600"
                            : "text-emerald-600"
                        }`}
                      >
                        残り
                      </div>
                      <div
                        className={`text-xl font-bold ${
                          remaining <= 0
                            ? "text-red-700"
                            : remaining <= 2
                            ? "text-amber-700"
                            : "text-emerald-700"
                        }`}
                      >
                        {Math.max(0, remaining)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Daily Summary */}
          {inventories.length > 0 && (
            <div className="mt-6 bg-indigo-50 rounded-xl border border-indigo-200 p-5">
              <h3 className="text-sm font-bold text-indigo-800 mb-3">
                この日のサマリー
              </h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-indigo-700">
                    {inventories.reduce((s, i) => s + i.production_quantity, 0)}
                  </div>
                  <div className="text-xs text-indigo-500 mt-1">製造合計</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-amber-700">
                    {inventories.reduce((s, i) => s + i.reserved_quantity, 0)}
                  </div>
                  <div className="text-xs text-amber-600 mt-1">予約合計</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-emerald-700">
                    {inventories.reduce(
                      (s, i) =>
                        s +
                        Math.max(0, i.production_quantity - i.reserved_quantity),
                      0
                    )}
                  </div>
                  <div className="text-xs text-emerald-600 mt-1">残り合計</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
