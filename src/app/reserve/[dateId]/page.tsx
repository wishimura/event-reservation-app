"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { supabase } from "@/lib/supabase";
import type { EventDate, DailyProductInventory, CartItem } from "@/lib/types";
import {
  formatDate,
  formatPrice,
  getRemainingQuantity,
} from "@/lib/utils";

export default function ProductSelectionPage() {
  const params = useParams();
  const router = useRouter();
  const dateId = params.dateId as string;

  const [eventDate, setEventDate] = useState<EventDate | null>(null);
  const [inventories, setInventories] = useState<DailyProductInventory[]>([]);
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const [dateRes, invRes] = await Promise.all([
        supabase
          .from("event_dates")
          .select("*")
          .eq("id", dateId)
          .single<EventDate>(),
        supabase
          .from("daily_product_inventory")
          .select("*, product:products(*)")
          .eq("event_date_id", dateId)
          .eq("is_hidden", false)
          .order("product(sort_order)"),
      ]);

      if (dateRes.data) setEventDate(dateRes.data);
      if (invRes.data) setInventories(invRes.data as DailyProductInventory[]);
      setLoading(false);
    }
    fetchData();
  }, [dateId]);

  const updateQuantity = useCallback(
    (productId: string, delta: number, max: number) => {
      setCart((prev) => {
        const next = new Map(prev);
        const current = next.get(productId) ?? 0;
        const updated = Math.max(0, Math.min(max, current + delta));
        if (updated === 0) {
          next.delete(productId);
        } else {
          next.set(productId, updated);
        }
        return next;
      });
    },
    []
  );

  const cartItems: CartItem[] = inventories
    .filter((inv) => cart.has(inv.product_id) && inv.product)
    .map((inv) => ({
      product: inv.product!,
      inventory: inv,
      quantity: cart.get(inv.product_id)!,
    }));

  const totalAmount = cartItems.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0
  );
  const totalCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  function handleProceed() {
    if (cartItems.length === 0) return;
    localStorage.setItem("cart", JSON.stringify(cartItems));
    localStorage.setItem(
      "selectedDate",
      JSON.stringify({
        id: eventDate!.id,
        pickup_date: eventDate!.pickup_date,
      })
    );
    router.push("/reserve/confirm");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="animate-pulse text-stone-400">読み込み中...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 pb-28">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/reserve"
            className="text-stone-400 hover:text-stone-600 transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </Link>
          <h1 className="text-lg font-bold text-stone-800">
            商品を選ぶ
          </h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Selected Date Banner */}
        {eventDate && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 flex items-center gap-3">
            <div className="w-12 h-12 bg-amber-600 text-white rounded-xl flex items-center justify-center text-lg font-bold shrink-0">
              {new Date(eventDate.pickup_date + "T00:00:00").getDate()}
            </div>
            <div>
              <p className="text-xs text-amber-600 font-medium">受取日</p>
              <p className="text-amber-900 font-bold text-lg">
                {formatDate(eventDate.pickup_date)}
              </p>
            </div>
          </div>
        )}

        {/* Product List */}
        <div className="space-y-4">
          {inventories.map((inv) => {
            if (!inv.product) return null;
            const product = inv.product;
            const remaining = getRemainingQuantity(inv);
            const isSoldOut = inv.is_sold_out || remaining === 0;
            const qty = cart.get(product.id) ?? 0;

            return (
              <div
                key={inv.id}
                className={`bg-white rounded-2xl border border-stone-200 overflow-hidden transition-opacity ${
                  isSoldOut ? "opacity-50" : ""
                }`}
              >
                <div className="flex gap-4 p-4">
                  {/* Product Image */}
                  <div className="w-24 h-24 rounded-xl bg-stone-100 overflow-hidden shrink-0 relative">
                    {product.image_url ? (
                      <Image
                        src={product.image_url}
                        alt={product.name}
                        fill
                        className="object-cover"
                        sizes="96px"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-3xl text-stone-300">
                        &#9749;
                      </div>
                    )}
                    {isSoldOut && (
                      <div className="absolute inset-0 bg-stone-900/50 flex items-center justify-center">
                        <span className="text-white text-xs font-bold bg-stone-800 px-2 py-1 rounded">
                          SOLD OUT
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Product Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-stone-800 text-sm mb-1 truncate">
                      {product.name}
                    </h3>
                    {product.description && (
                      <p className="text-xs text-stone-400 mb-2 line-clamp-2">
                        {product.description}
                      </p>
                    )}
                    <p className="text-amber-700 font-bold text-base">
                      {formatPrice(product.price)}
                    </p>
                    {!isSoldOut && (
                      <p className="text-xs text-stone-400 mt-1">
                        残り {remaining} 個
                      </p>
                    )}
                  </div>
                </div>

                {/* Quantity Selector */}
                {!isSoldOut && (
                  <div className="border-t border-stone-100 px-4 py-3 flex items-center justify-between bg-stone-50/50">
                    <span className="text-xs text-stone-500">数量</span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() =>
                          updateQuantity(product.id, -1, remaining)
                        }
                        disabled={qty === 0}
                        className={`w-9 h-9 rounded-full flex items-center justify-center text-lg font-medium transition-colors ${
                          qty === 0
                            ? "bg-stone-200 text-stone-400 cursor-not-allowed"
                            : "bg-amber-100 text-amber-800 hover:bg-amber-200 active:bg-amber-300"
                        }`}
                      >
                        -
                      </button>
                      <span className="w-8 text-center font-bold text-stone-800 text-lg tabular-nums">
                        {qty}
                      </span>
                      <button
                        onClick={() =>
                          updateQuantity(product.id, 1, remaining)
                        }
                        disabled={qty >= remaining}
                        className={`w-9 h-9 rounded-full flex items-center justify-center text-lg font-medium transition-colors ${
                          qty >= remaining
                            ? "bg-stone-200 text-stone-400 cursor-not-allowed"
                            : "bg-amber-600 text-white hover:bg-amber-700 active:bg-amber-800"
                        }`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {inventories.length === 0 && (
          <div className="text-center py-12 text-stone-400">
            <p className="text-4xl mb-3">&#128230;</p>
            <p>この日の商品はまだ登録されていません</p>
          </div>
        )}
      </div>

      {/* Floating Cart Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-20">
        <div className="max-w-lg mx-auto">
          <div className="bg-white border-t border-stone-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] px-4 py-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-xs text-stone-400">合計</span>
                <span className="text-stone-400 mx-1">|</span>
                <span className="text-xs text-stone-500">
                  {totalCount} 点
                </span>
              </div>
              <p className="text-xl font-bold text-amber-800">
                {formatPrice(totalAmount)}
              </p>
            </div>
            <button
              onClick={handleProceed}
              disabled={totalCount === 0}
              className={`w-full py-3.5 rounded-2xl font-bold text-base transition-colors ${
                totalCount === 0
                  ? "bg-stone-200 text-stone-400 cursor-not-allowed"
                  : "bg-amber-700 hover:bg-amber-800 active:bg-amber-900 text-white shadow-lg shadow-amber-700/20"
              }`}
            >
              確認へ進む
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
