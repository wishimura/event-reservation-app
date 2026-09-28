"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, fetchJson } from "@/lib/api-client";
import { LoadErrorNotice } from "@/components/LoadErrorNotice";
import { formatDate, formatPrice, todayInJST } from "@/lib/utils";
import type { EventDate, DailyProductInventory, Product } from "@/lib/types";

type InventoryWithProduct = DailyProductInventory & {
  product: Product;
};

export default function ProductionPage() {
  const [eventDates, setEventDates] = useState<EventDate[]>([]);
  const [selectedDateId, setSelectedDateId] = useState<string>("");
  const [allInventories, setAllInventories] = useState<
    Map<string, InventoryWithProduct[]>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [viewMode, setViewMode] = useState<"single" | "all">("all");

  useEffect(() => {
    loadProductionPlan();
  }, []);

  // One request covers both views; the single-date view is just a slice of it.
  async function loadProductionPlan() {
    setLoadError("");
    try {
      const { dates, inventory } = await fetchJson<{
        dates: EventDate[];
        inventory: InventoryWithProduct[];
      }>("/api/admin/production");

      setEventDates(dates);

      // Land on the day the shop is working on, not the first of the run.
      // During the event that is today; before it starts, the next one up.
      if (dates.length > 0) {
        const today = todayInJST();
        const upcoming = dates.find((d) => d.pickup_date >= today);
        setSelectedDateId((upcoming ?? dates[dates.length - 1]).id);
      }

      const map = new Map<string, InventoryWithProduct[]>();
      for (const inv of inventory) {
        const existing = map.get(inv.event_date_id) ?? [];
        existing.push(inv);
        map.set(inv.event_date_id, existing);
      }
      setAllInventories(map);
    } catch (err) {
      console.error("Production load error:", err);
      setLoadError(
        err instanceof ApiError ? err.message : "サーバーとの通信に失敗しました"
      );
    } finally {
      setLoading(false);
    }
  }

  const allLoading = loading;

  const inventories = useMemo(
    () => allInventories.get(selectedDateId) ?? [],
    [allInventories, selectedDateId]
  );

  /**
   * The product rows of the matrix.
   *
   * Every product that appears on any date, not the products of whichever
   * date happened to come back first. A product missing from that one date
   * used to vanish from the whole table, reservations and all — a production
   * plan that quietly leaves something out is worse than no plan.
   */
  const productNames = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; sort: number }>();

    for (const rows of allInventories.values()) {
      for (const inv of rows) {
        if (!inv.product || byId.has(inv.product.id)) continue;
        byId.set(inv.product.id, {
          id: inv.product.id,
          name: inv.product.name,
          sort: inv.product.sort_order,
        });
      }
    }

    return [...byId.values()].sort((a, b) => a.sort - b.sort);
  }, [allInventories]);

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
          loadProductionPlan();
        }}
      />
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 sm:text-2xl">
            製造計画
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            予約状況に応じて、日付ごとの製造数を確認できます
          </p>
        </div>
        <div className="flex shrink-0 rounded-lg bg-slate-100 p-1">
          <button
            onClick={() => setViewMode("all")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none ${
              viewMode === "all"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            全日程一覧
          </button>
          <button
            onClick={() => setViewMode("single")}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors sm:flex-none ${
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
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 md:px-5">
            <p className="text-xs text-slate-500">
              ※ 受注生産のため、<span className="font-medium text-slate-700">予約数 ＝ 製造数</span>です。受付上限はその日に受け付けられる最大数を示します。
            </p>
            <p className="mt-1 text-xs text-slate-400 md:hidden">
              表は横にスクロールできます。左端の商品名は固定されています。
            </p>
          </div>
          {allLoading ? (
            <div className="p-12 text-center text-slate-400">読み込み中...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs md:text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="sticky left-0 z-10 min-w-[104px] bg-slate-50 px-3 py-3 text-left font-medium text-slate-500 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] md:min-w-[140px] md:px-4">
                      商品名
                    </th>
                    {eventDates.map((d) => (
                      <th
                        key={d.id}
                        className="min-w-[62px] px-2 py-3 text-center font-medium text-slate-500 md:min-w-[80px] md:px-3"
                      >
                        <div className="text-xs">{formatDate(d.pickup_date)}</div>
                      </th>
                    ))}
                    <th className="min-w-[62px] bg-indigo-50 px-2 py-3 text-center font-medium text-slate-500 md:min-w-[80px] md:px-4">
                      合計
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {productNames.map((p: { id: string; name: string }) => (
                    <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                      <td className="sticky left-0 z-10 bg-white px-3 py-3 font-medium text-slate-800 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] md:px-4">
                        {p.name}
                      </td>
                      {eventDates.map((d) => {
                        const inv = allInventories
                          .get(d.id)
                          ?.find((i) => i.product.id === p.id);
                        const reserved = inv?.reserved_quantity ?? 0;
                        const limit = inv?.production_quantity ?? 0;
                        return (
                          <td key={d.id} className="px-2 py-3 text-center md:px-3">
                            <div className={`text-sm font-bold md:text-base ${reserved > 0 ? "text-indigo-700" : "text-slate-300"}`}>
                              {reserved}
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              / {limit}
                            </div>
                          </td>
                        );
                      })}
                      <td className="bg-indigo-50/50 px-2 py-3 text-center md:px-4">
                        <div className="font-bold text-indigo-700">
                          {eventDates.reduce((sum, d) => {
                            const inv = allInventories
                              .get(d.id)
                              ?.find((i) => i.product.id === p.id);
                            return sum + (inv?.reserved_quantity ?? 0);
                          }, 0)}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          / {eventDates.reduce((sum, d) => {
                            const inv = allInventories
                              .get(d.id)
                              ?.find((i) => i.product.id === p.id);
                            return sum + (inv?.production_quantity ?? 0);
                          }, 0)}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {/* Total row */}
                  <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                    <td className="sticky left-0 z-10 bg-slate-50 px-3 py-3 text-slate-700 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] md:px-4">
                      合計
                    </td>
                    {eventDates.map((d) => {
                      const invs = allInventories.get(d.id) || [];
                      const totalReserved = invs.reduce(
                        (s, i) => s + i.reserved_quantity,
                        0
                      );
                      const totalLimit = invs.reduce(
                        (s, i) => s + i.production_quantity,
                        0
                      );
                      return (
                        <td key={d.id} className="px-2 py-3 text-center md:px-3">
                          <div className={`${totalReserved > 0 ? "text-slate-800" : "text-slate-300"}`}>
                            {totalReserved}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            / {totalLimit}
                          </div>
                        </td>
                      );
                    })}
                    <td className="bg-indigo-50/50 px-2 py-3 text-center text-indigo-700 md:px-4">
                      {eventDates.reduce((sum, d) => {
                        const invs = allInventories.get(d.id) || [];
                        return sum + invs.reduce((s, i) => s + i.reserved_quantity, 0);
                      }, 0)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500 md:px-5">
            <span>表の見方：</span>
            <span><span className="font-bold text-indigo-700">太字</span> ＝ 予約数（＝製造数）</span>
            <span><span className="text-slate-400">/ 数字</span> ＝ 受付上限</span>
          </div>
        </div>
      ) : (
        /* ===== Single Date Detail ===== */
        <>
          {/* Date Selector */}
          <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-xs text-slate-500">受取日を選択</p>
            {/*
              Twelve dates wrap into a block that fills a phone screen, so on
              mobile they stay on one scrolling line. The negative margin lets
              it run to the card's edge, which is what makes it read as
              scrollable rather than clipped.
            */}
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
              {eventDates.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDateId(d.id)}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
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

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
            <p className="text-sm text-amber-800">
              受注生産のため、<span className="font-bold">予約数 ＝ その日の製造数</span>です。
            </p>
          </div>

          {/* Production Detail Cards */}
          <div className="space-y-4">
            {inventories.map((inv) => {
              if (!inv.product) return null;
              const remaining = inv.production_quantity - inv.reserved_quantity;

              return (
                <div
                  key={inv.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 md:p-5"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-base font-bold text-slate-800 md:text-lg">
                        {inv.product.name}
                      </h3>
                      <p className="text-sm text-slate-400 mt-0.5">
                        {formatPrice(inv.product.price)} / 個
                      </p>
                    </div>
                    {inv.reserved_quantity > 0 && (
                      <div className="text-right">
                        <div className="text-2xl font-bold text-indigo-600 md:text-3xl">
                          {inv.reserved_quantity}
                        </div>
                        <div className="text-xs text-indigo-500">個 つくる</div>
                      </div>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div className="mb-3">
                    <div className="mb-1 flex flex-wrap justify-between gap-x-2 text-xs text-slate-500">
                      <span>予約 {inv.reserved_quantity} / 上限 {inv.production_quantity}</span>
                      <span>あと {Math.max(0, remaining)} 個受付可</span>
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
                          // production_quantity can legitimately be 0 for a
                          // product not offered that day; 0/0 would render NaN%.
                          width: `${
                            inv.production_quantity > 0
                              ? Math.min(
                                  100,
                                  (inv.reserved_quantity /
                                    inv.production_quantity) *
                                    100
                                )
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 text-sm md:gap-4">
                    <div className="flex-1 rounded-lg bg-indigo-50 p-2 text-center md:p-3">
                      <div className="mb-1 text-[11px] leading-tight text-indigo-500 md:text-xs">
                        予約数
                        <span className="hidden md:inline">（＝製造数）</span>
                      </div>
                      <div className="text-xl font-bold text-indigo-700">
                        {inv.reserved_quantity}
                      </div>
                    </div>
                    <div className="flex-1 rounded-lg bg-slate-50 p-2 text-center md:p-3">
                      <div className="mb-1 text-[11px] leading-tight text-slate-400 md:text-xs">
                        受付上限
                      </div>
                      <div className="text-xl font-bold text-slate-600">
                        {inv.production_quantity}
                      </div>
                    </div>
                    <div
                      className={`flex-1 rounded-lg p-2 text-center md:p-3 ${
                        remaining <= 0
                          ? "bg-red-50"
                          : remaining <= 2
                          ? "bg-amber-50"
                          : "bg-emerald-50"
                      }`}
                    >
                      <div
                        className={`mb-1 text-[11px] leading-tight md:text-xs ${
                          remaining <= 0
                            ? "text-red-600"
                            : remaining <= 2
                            ? "text-amber-600"
                            : "text-emerald-600"
                        }`}
                      >
                        残り受付枠
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
            <div className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4 md:p-5">
              <h3 className="text-sm font-bold text-indigo-800 mb-3">
                この日のサマリー
              </h3>
              <div className="grid grid-cols-3 gap-2 md:gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-indigo-700">
                    {inventories.reduce((s, i) => s + i.reserved_quantity, 0)}
                  </div>
                  <div className="mt-1 text-[11px] leading-tight text-indigo-500 md:text-xs">
                    製造数<span className="hidden md:inline">（＝予約数）</span>
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-slate-600">
                    {inventories.reduce((s, i) => s + i.production_quantity, 0)}
                  </div>
                  <div className="mt-1 text-[11px] leading-tight text-slate-500 md:text-xs">
                    受付上限
                  </div>
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
                  <div className="mt-1 text-[11px] leading-tight text-emerald-600 md:text-xs">
                    残り受付枠
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
