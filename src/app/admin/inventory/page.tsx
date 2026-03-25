"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { formatDate, getRemainingQuantity } from "@/lib/utils";
import type { Event, EventDate, DailyProductInventory } from "@/lib/types";

interface EditableInventory extends DailyProductInventory {
  _editedQty: number;
  _editedSoldOut: boolean;
  _editedHidden: boolean;
  _dirty: boolean;
}

export default function InventoryPage() {
  const [event, setEvent] = useState<Event | null>(null);
  const [eventDates, setEventDates] = useState<EventDate[]>([]);
  const [selectedDateId, setSelectedDateId] = useState<string>("");
  const [inventory, setInventory] = useState<EditableInventory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInventory = useCallback(async (dateId: string) => {
    if (!dateId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from("daily_product_inventory")
        .select("*, product:products(*)")
        .eq("event_date_id", dateId);

      if (data) {
        const editable: EditableInventory[] = data
          .sort((a: DailyProductInventory, b: DailyProductInventory) =>
            (a.product?.sort_order ?? 0) - (b.product?.sort_order ?? 0)
          )
          .map((inv: DailyProductInventory) => ({
            ...inv,
            _editedQty: inv.production_quantity,
            _editedSoldOut: inv.is_sold_out,
            _editedHidden: inv.is_hidden,
            _dirty: false,
          }));
        setInventory(editable);
      }
    } catch (err) {
      console.error("Inventory load error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedDateId) {
      loadInventory(selectedDateId);
    }
  }, [selectedDateId, loadInventory]);

  async function loadInitialData() {
    try {
      const { data: ev } = await supabase
        .from("events")
        .select("*")
        .eq("is_active", true)
        .single();
      if (!ev) return;
      setEvent(ev);

      const { data: dates } = await supabase
        .from("event_dates")
        .select("*")
        .eq("event_id", ev.id)
        .order("pickup_date");

      if (dates && dates.length > 0) {
        setEventDates(dates);
        // Select today or the first upcoming date
        const today = new Date().toISOString().split("T")[0];
        const todayDate = dates.find((d: EventDate) => d.pickup_date === today);
        const upcomingDate = dates.find((d: EventDate) => d.pickup_date >= today);
        setSelectedDateId((todayDate || upcomingDate || dates[0]).id);
      }
    } catch (err) {
      console.error("Init error:", err);
    } finally {
      setLoading(false);
    }
  }

  function updateField(id: string, field: "_editedQty" | "_editedSoldOut" | "_editedHidden", value: number | boolean) {
    setInventory((prev) =>
      prev.map((inv) => {
        if (inv.id !== id) return inv;
        const updated = { ...inv, [field]: value, _dirty: true };
        return updated;
      })
    );
  }

  async function handleSave() {
    const dirtyItems = inventory.filter((i) => i._dirty);
    if (dirtyItems.length === 0) {
      setSaveMsg("変更はありません");
      setTimeout(() => setSaveMsg(""), 2000);
      return;
    }

    setSaving(true);
    setSaveMsg("");
    try {
      for (const item of dirtyItems) {
        await supabase
          .from("daily_product_inventory")
          .update({
            production_quantity: item._editedQty,
            is_sold_out: item._editedSoldOut,
            is_hidden: item._editedHidden,
          })
          .eq("id", item.id);
      }
      setSaveMsg(`${dirtyItems.length} 件を保存しました`);
      setTimeout(() => setSaveMsg(""), 3000);
      // Reload
      await loadInventory(selectedDateId);
    } catch (err) {
      console.error("Save error:", err);
      setSaveMsg("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyPreviousDay() {
    const currentIdx = eventDates.findIndex((d) => d.id === selectedDateId);
    if (currentIdx <= 0) {
      setSaveMsg("前日のデータがありません");
      setTimeout(() => setSaveMsg(""), 2000);
      return;
    }

    const prevDateId = eventDates[currentIdx - 1].id;
    try {
      const { data: prevInv } = await supabase
        .from("daily_product_inventory")
        .select("*")
        .eq("event_date_id", prevDateId);

      if (prevInv) {
        setInventory((curr) =>
          curr.map((inv) => {
            const match = prevInv.find(
              (p: DailyProductInventory) => p.product_id === inv.product_id
            );
            if (!match) return inv;
            return {
              ...inv,
              _editedQty: match.production_quantity,
              _editedSoldOut: match.is_sold_out,
              _editedHidden: match.is_hidden,
              _dirty: true,
            };
          })
        );
        setSaveMsg("前日の設定をコピーしました（保存を押してください）");
        setTimeout(() => setSaveMsg(""), 4000);
      }
    } catch (err) {
      console.error("Copy error:", err);
    }
  }

  const hasDirtyItems = inventory.some((i) => i._dirty);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h2 className="text-2xl font-bold text-slate-800">在庫管理</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={handleCopyPreviousDay}
            className="px-4 py-2 text-sm bg-white border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700 transition-colors"
          >
            前日の設定をコピー
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !hasDirtyItems}
            className={`px-6 py-2 text-sm font-medium rounded-lg transition-colors ${
              hasDirtyItems
                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                : "bg-slate-200 text-slate-400 cursor-not-allowed"
            }`}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>

      {/* Date Selector */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <label className="block text-xs font-medium text-slate-500 mb-2">受取日を選択</label>
        <div className="flex flex-wrap gap-2">
          {eventDates.map((d) => {
            const today = new Date().toISOString().split("T")[0];
            const isToday = d.pickup_date === today;
            const isPast = d.pickup_date < today;
            return (
              <button
                key={d.id}
                onClick={() => setSelectedDateId(d.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  d.id === selectedDateId
                    ? "bg-indigo-600 text-white"
                    : isPast
                    ? "bg-slate-100 text-slate-400 hover:bg-slate-200"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                } ${isToday ? "ring-2 ring-indigo-300" : ""}`}
              >
                {formatDate(d.pickup_date)}
                {isToday && <span className="ml-1 text-xs">(今日)</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Save message */}
      {saveMsg && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm ${
          saveMsg.includes("失敗") ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
        }`}>
          {saveMsg}
        </div>
      )}

      {/* Inventory Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-5 py-3 font-medium text-slate-500">商品名</th>
                <th className="text-center px-5 py-3 font-medium text-slate-500 w-32">製造数</th>
                <th className="text-center px-5 py-3 font-medium text-slate-500 w-24">予約数</th>
                <th className="text-center px-5 py-3 font-medium text-slate-500 w-24">残り</th>
                <th className="text-center px-5 py-3 font-medium text-slate-500 w-32">ステータス</th>
                <th className="text-center px-5 py-3 font-medium text-slate-500 w-24">非表示</th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((inv) => {
                const remaining = inv._editedQty - inv.reserved_quantity;
                const isLow = remaining > 0 && remaining <= inv.warning_threshold;
                return (
                  <tr
                    key={inv.id}
                    className={`border-t border-slate-100 ${
                      inv._dirty ? "bg-indigo-50/50" : "hover:bg-slate-50"
                    } ${inv._editedHidden ? "opacity-50" : ""}`}
                  >
                    <td className="px-5 py-3">
                      <span className="font-medium text-slate-800">{inv.product?.name}</span>
                      {inv._dirty && (
                        <span className="ml-2 text-xs text-indigo-500">*変更あり</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <input
                        type="number"
                        min={0}
                        value={inv._editedQty}
                        onChange={(e) =>
                          updateField(inv.id, "_editedQty", Math.max(0, parseInt(e.target.value) || 0))
                        }
                        className="w-20 text-center border border-slate-300 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none"
                      />
                    </td>
                    <td className="px-5 py-3 text-center text-slate-700">{inv.reserved_quantity}</td>
                    <td className="px-5 py-3 text-center">
                      <span
                        className={`font-medium ${
                          remaining <= 0
                            ? "text-red-600"
                            : isLow
                            ? "text-amber-600"
                            : "text-emerald-600"
                        }`}
                      >
                        {Math.max(0, remaining)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button
                        onClick={() =>
                          updateField(inv.id, "_editedSoldOut", !inv._editedSoldOut)
                        }
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          inv._editedSoldOut
                            ? "bg-red-100 text-red-700 hover:bg-red-200"
                            : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                        }`}
                      >
                        {inv._editedSoldOut ? "売切" : "販売中"}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <button
                        onClick={() =>
                          updateField(inv.id, "_editedHidden", !inv._editedHidden)
                        }
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          inv._editedHidden
                            ? "bg-slate-200 text-slate-600 hover:bg-slate-300"
                            : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                        }`}
                      >
                        {inv._editedHidden ? "非表示" : "表示中"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && inventory.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-slate-400">
                    この日付の在庫データがありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="text-slate-400">読み込み中...</div>
        </div>
      )}
    </div>
  );
}
