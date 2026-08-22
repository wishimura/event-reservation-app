"use client";

import { useEffect, useState } from "react";
import { ApiError, fetchJson } from "@/lib/api-client";
import { LoadErrorNotice } from "@/components/LoadErrorNotice";
import { formatPrice } from "@/lib/utils";
import type { Product } from "@/lib/types";

type ProductWithCount = Product & { order_count: number };

interface Draft {
  name: string;
  description: string;
  price: string;
  sort_order: string;
  is_active: boolean;
}

function toDraft(p: ProductWithCount): Draft {
  return {
    name: p.name,
    description: p.description,
    price: String(p.price),
    sort_order: String(p.sort_order),
    is_active: p.is_active,
  };
}

const newDraft: Draft = {
  name: "",
  description: "",
  price: "",
  sort_order: "",
  is_active: true,
};

export default function ProductsPage() {
  const [products, setProducts] = useState<ProductWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(
    null
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(newDraft);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(newDraft);
  const [addCapacity, setAddCapacity] = useState("0");

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
      const data = await fetchJson<{ products: ProductWithCount[] }>(
        "/api/admin/products"
      );
      setProducts(data.products);
    } catch (err) {
      console.error("Products load error:", err);
      setLoadError(describe(err, "サーバーとの通信に失敗しました"));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(id: string) {
    setBusyId(id);
    try {
      await fetchJson(`/api/admin/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: draft.name,
          description: draft.description,
          price: parseInt(draft.price, 10) || 0,
          sort_order: parseInt(draft.sort_order, 10) || 0,
          is_active: draft.is_active,
        }),
      });
      setEditingId(null);
      await load();
      notify("商品を保存しました", true);
    } catch (err) {
      console.error("Product save error:", err);
      notify(describe(err, "保存に失敗しました"), false);
    } finally {
      setBusyId(null);
    }
  }

  async function handleAdd() {
    setBusyId("new");
    try {
      const res = await fetchJson<{ inventory_rows: number }>(
        "/api/admin/products",
        {
          method: "POST",
          body: JSON.stringify({
            name: addDraft.name,
            description: addDraft.description,
            price: parseInt(addDraft.price, 10) || 0,
            sort_order: parseInt(addDraft.sort_order, 10) || 0,
            default_capacity: parseInt(addCapacity, 10) || 0,
          }),
        }
      );
      setAdding(false);
      setAddDraft(newDraft);
      setAddCapacity("0");
      await load();
      notify(
        `商品を追加し、受取日 ${res.inventory_rows} 日ぶんの受付枠を作成しました`,
        true
      );
    } catch (err) {
      console.error("Product add error:", err);
      notify(describe(err, "商品の追加に失敗しました"), false);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(p: ProductWithCount) {
    if (
      !window.confirm(
        `「${p.name}」を削除します。全受取日の受付枠設定も消えます。よろしいですか？`
      )
    ) {
      return;
    }
    setBusyId(p.id);
    try {
      await fetchJson(`/api/admin/products/${p.id}`, { method: "DELETE" });
      await load();
      notify("商品を削除しました", true);
    } catch (err) {
      console.error("Product delete error:", err);
      notify(describe(err, "削除に失敗しました"), false);
    } finally {
      setBusyId(null);
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

  const field =
    "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none";
  const label = "block text-xs font-medium text-slate-500 mb-1";

  function draftFields(d: Draft, set: (next: Draft) => void) {
    return (
      <div className="space-y-3">
        <div>
          <label className={label}>商品名</label>
          <input
            className={field}
            value={d.name}
            onChange={(e) => set({ ...d, name: e.target.value })}
          />
        </div>
        <div>
          <label className={label}>説明</label>
          <textarea
            className={`${field} min-h-16`}
            value={d.description}
            onChange={(e) => set({ ...d, description: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>価格（円・税込）</label>
            <input
              type="text"
              inputMode="numeric"
              className={field}
              value={d.price}
              onChange={(e) =>
                set({ ...d, price: e.target.value.replace(/[^0-9]/g, "") })
              }
            />
          </div>
          <div>
            <label className={label}>並び順（小さいほど上）</label>
            <input
              type="text"
              inputMode="numeric"
              className={field}
              value={d.sort_order}
              onChange={(e) =>
                set({ ...d, sort_order: e.target.value.replace(/[^0-9]/g, "") })
              }
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-2xl font-bold text-slate-800">商品マスタ</h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700"
          >
            商品を追加
          </button>
        )}
      </div>
      <p className="text-sm text-slate-500 mb-6">
        価格と説明はお客様向けページにそのまま出ます。受付上限の調整は「在庫管理」です。
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

      {adding && (
        <div className="bg-white rounded-xl border border-indigo-300 p-5 mb-6">
          <h3 className="text-sm font-bold text-slate-700 mb-4">商品を追加</h3>
          {draftFields(addDraft, setAddDraft)}
          <div className="mt-3">
            <label className={label}>受付上限の初期値（全受取日に適用）</label>
            <input
              type="text"
              inputMode="numeric"
              className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none"
              value={addCapacity}
              onChange={(e) =>
                setAddCapacity(e.target.value.replace(/[^0-9]/g, ""))
              }
            />
            <p className="mt-1 text-xs text-slate-400">
              0 のままだと全日程で売り切れ表示になります。あとから在庫管理で変更できます。
            </p>
          </div>
          <div className="mt-5 flex justify-end gap-3">
            <button
              onClick={() => {
                setAdding(false);
                setAddDraft(newDraft);
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
            >
              キャンセル
            </button>
            <button
              onClick={handleAdd}
              disabled={busyId === "new"}
              className="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              {busyId === "new" ? "追加中..." : "追加"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {products.map((p) => {
          const isEditing = editingId === p.id;
          return (
            <div
              key={p.id}
              className={`bg-white rounded-xl border p-5 ${
                p.is_active ? "border-slate-200" : "border-slate-200 opacity-60"
              }`}
            >
              {isEditing ? (
                <>
                  {draftFields(draft, setDraft)}
                  <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={draft.is_active}
                      onChange={(e) =>
                        setDraft({ ...draft, is_active: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    販売中（外すとお客様向けページから消えます）
                  </label>
                  <div className="mt-5 flex justify-end gap-3">
                    <button
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={() => handleSave(p.id)}
                      disabled={busyId === p.id}
                      className="rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {busyId === p.id ? "保存中..." : "保存"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-800">{p.name}</span>
                      {!p.is_active && (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">
                          販売停止中
                        </span>
                      )}
                      <span className="text-xs text-slate-400">
                        並び順 {p.sort_order}
                      </span>
                    </div>
                    {p.description && (
                      <p className="mt-1 text-sm text-slate-500">
                        {p.description}
                      </p>
                    )}
                    <p className="mt-1 text-sm font-medium text-indigo-700">
                      {formatPrice(p.price)}
                      <span className="ml-3 text-xs font-normal text-slate-400">
                        注文 {p.order_count} 件
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setDraft(toDraft(p));
                        setEditingId(p.id);
                      }}
                      className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => handleDelete(p)}
                      disabled={busyId === p.id || p.order_count > 0}
                      title={
                        p.order_count > 0
                          ? "注文があるため削除できません。販売停止をご利用ください"
                          : undefined
                      }
                      className="rounded-lg border border-red-300 px-4 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-300"
                    >
                      削除
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {products.length === 0 && (
          <p className="py-12 text-center text-sm text-slate-400">
            商品がまだ登録されていません
          </p>
        )}
      </div>
    </div>
  );
}
