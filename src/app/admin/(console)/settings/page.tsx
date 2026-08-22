"use client";

import { useEffect, useState } from "react";
import { ApiError, fetchJson } from "@/lib/api-client";
import { LoadErrorNotice } from "@/components/LoadErrorNotice";
import { formatDate, todayInJST } from "@/lib/utils";
import type { Event, EventDate } from "@/lib/types";

type DateWithCount = EventDate & { order_count: number };

const emptyForm = {
  name: "",
  description: "",
  start_date: "",
  end_date: "",
  pickup_location: "",
  contact_phone: "",
  reservation_note: "",
};

export default function SettingsPage() {
  const [form, setForm] = useState(emptyForm);
  const [dates, setDates] = useState<DateWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(
    null
  );

  const [newDate, setNewDate] = useState("");
  const [newDateCapacity, setNewDateCapacity] = useState("0");
  const [busyDateId, setBusyDateId] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  function notify(text: string, ok: boolean) {
    setMessage({ text, ok });
    setTimeout(() => setMessage(null), ok ? 3000 : 7000);
  }

  function describe(err: unknown, fallback: string) {
    return err instanceof ApiError ? err.message : fallback;
  }

  async function load() {
    setLoadError("");
    try {
      const data = await fetchJson<{ event: Event; dates: DateWithCount[] }>(
        "/api/admin/event"
      );
      setForm({
        name: data.event.name,
        description: data.event.description,
        start_date: data.event.start_date,
        end_date: data.event.end_date,
        pickup_location: data.event.pickup_location,
        contact_phone: data.event.contact_phone ?? "",
        reservation_note: data.event.reservation_note,
      });
      setDates(data.dates);
    } catch (err) {
      console.error("Settings load error:", err);
      setLoadError(describe(err, "サーバーとの通信に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetchJson("/api/admin/event", {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      notify("イベント情報を保存しました", true);
    } catch (err) {
      console.error("Settings save error:", err);
      notify(describe(err, "保存に失敗しました"), false);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddDate() {
    if (!newDate) {
      notify("追加する日付を選んでください", false);
      return;
    }
    setBusyDateId("new");
    try {
      const res = await fetchJson<{ inventory_rows: number }>(
        "/api/admin/event/dates",
        {
          method: "POST",
          body: JSON.stringify({
            pickup_date: newDate,
            default_capacity: parseInt(newDateCapacity, 10) || 0,
          }),
        }
      );
      setNewDate("");
      await load();
      notify(
        `受取日を追加し、商品 ${res.inventory_rows} 件ぶんの受付枠を作成しました`,
        true
      );
    } catch (err) {
      console.error("Date add error:", err);
      notify(describe(err, "受取日の追加に失敗しました"), false);
    } finally {
      setBusyDateId(null);
    }
  }

  async function handleToggleDate(date: DateWithCount) {
    setBusyDateId(date.id);
    try {
      await fetchJson(`/api/admin/event/dates/${date.id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !date.is_active }),
      });
      await load();
      notify(
        date.is_active
          ? `${formatDate(date.pickup_date)} の受付を停止しました`
          : `${formatDate(date.pickup_date)} の受付を再開しました`,
        true
      );
    } catch (err) {
      console.error("Date toggle error:", err);
      notify(describe(err, "受取日の更新に失敗しました"), false);
    } finally {
      setBusyDateId(null);
    }
  }

  async function handleDeleteDate(date: DateWithCount) {
    if (
      !window.confirm(
        `${formatDate(date.pickup_date)} を削除します。この日の受付枠の設定も消えます。よろしいですか？`
      )
    ) {
      return;
    }
    setBusyDateId(date.id);
    try {
      await fetchJson(`/api/admin/event/dates/${date.id}`, {
        method: "DELETE",
      });
      await load();
      notify("受取日を削除しました", true);
    } catch (err) {
      console.error("Date delete error:", err);
      notify(describe(err, "受取日の削除に失敗しました"), false);
    } finally {
      setBusyDateId(null);
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
          load();
        }}
      />
    );
  }

  const today = todayInJST();
  const field =
    "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none";
  const label = "block text-xs font-medium text-slate-500 mb-1";

  return (
    <div>
      <h2 className="text-2xl font-bold text-slate-800 mb-1">イベント設定</h2>
      <p className="text-sm text-slate-500 mb-6">
        ここで変更した内容は、お客様向けページにすぐ反映されます。
      </p>

      {message && (
        <div
          className={`mb-6 rounded-lg px-4 py-2.5 text-sm ${
            message.ok
              ? "bg-emerald-50 text-emerald-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Basics */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <h3 className="text-sm font-bold text-slate-700 mb-4">基本情報</h3>
        <div className="space-y-4">
          <div>
            <label className={label}>イベント名</label>
            <input
              className={field}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <label className={label}>紹介文</label>
            <textarea
              className={`${field} min-h-20`}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={label}>開催開始日</label>
              <input
                type="date"
                className={field}
                value={form.start_date}
                onChange={(e) =>
                  setForm({ ...form, start_date: e.target.value })
                }
              />
            </div>
            <div>
              <label className={label}>開催終了日</label>
              <input
                type="date"
                className={field}
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className={label}>受取場所</label>
            <input
              className={field}
              value={form.pickup_location}
              onChange={(e) =>
                setForm({ ...form, pickup_location: e.target.value })
              }
            />
          </div>
          <div>
            <label className={label}>
              連絡先電話番号（変更・キャンセルの受付先）
            </label>
            <input
              type="tel"
              inputMode="tel"
              placeholder="070-6669-1010"
              className={field}
              value={form.contact_phone}
              onChange={(e) =>
                setForm({ ...form, contact_phone: e.target.value })
              }
            />
            <p className="mt-1 text-xs text-slate-400">
              予約完了画面と確認メールに、この番号への発信ボタンが表示されます。空にすると表示されません。
            </p>
          </div>
          <div>
            <label className={label}>ご注意（改行できます）</label>
            <textarea
              className={`${field} min-h-24`}
              value={form.reservation_note}
              onChange={(e) =>
                setForm({ ...form, reservation_note: e.target.value })
              }
            />
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>

      {/* Pickup dates */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-1">受取日</h3>
        <p className="text-xs text-slate-500 mb-4">
          日付を追加すると、全商品ぶんの受付枠が自動で作られます。上限は追加後に「在庫管理」で調整してください。
        </p>

        <div className="flex flex-wrap items-end gap-3 mb-5 rounded-lg bg-slate-50 p-4">
          <div>
            <label className={label}>追加する日付</label>
            <input
              type="date"
              min={today}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
            />
          </div>
          <div>
            <label className={label}>受付上限の初期値</label>
            <input
              type="text"
              inputMode="numeric"
              className="w-28 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none"
              value={newDateCapacity}
              onChange={(e) =>
                setNewDateCapacity(e.target.value.replace(/[^0-9]/g, ""))
              }
            />
          </div>
          <button
            onClick={handleAddDate}
            disabled={busyDateId === "new"}
            className="rounded-lg bg-slate-800 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-900 disabled:opacity-50"
          >
            {busyDateId === "new" ? "追加中..." : "受取日を追加"}
          </button>
        </div>

        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {dates.map((d) => (
            <div
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`font-medium ${
                    d.is_active ? "text-slate-800" : "text-slate-400"
                  }`}
                >
                  {formatDate(d.pickup_date)}
                </span>
                {!d.is_active && (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                    受付停止中
                  </span>
                )}
                <span className="text-xs text-slate-500">
                  予約 {d.order_count} 件
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggleDate(d)}
                  disabled={busyDateId === d.id}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  {d.is_active ? "受付停止" : "受付再開"}
                </button>
                <button
                  onClick={() => handleDeleteDate(d)}
                  disabled={busyDateId === d.id || d.order_count > 0}
                  title={
                    d.order_count > 0
                      ? "予約が入っているため削除できません"
                      : undefined
                  }
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
          {dates.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">
              受取日がまだ登録されていません
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
