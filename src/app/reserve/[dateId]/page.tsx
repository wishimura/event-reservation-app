"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { fetchJson } from "@/lib/api-client";
import type { EventDate, DailyProductInventory, CartItem } from "@/lib/types";
import {
  formatDate,
  formatPrice,
  getRemainingQuantity,
} from "@/lib/utils";
import { Icon } from "@/components/Icon";

export default function ProductSelectionPage() {
  const params = useParams();
  const router = useRouter();
  const dateId = params.dateId as string;

  const [eventDate, setEventDate] = useState<EventDate | null>(null);
  const [inventories, setInventories] = useState<DailyProductInventory[]>([]);
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [capNoticeId, setCapNoticeId] = useState<string | null>(null);
  const capNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (capNoticeTimer.current) clearTimeout(capNoticeTimer.current);
    },
    []
  );

  useEffect(() => {
    async function fetchData() {
      try {
        const data = await fetchJson<{
          event_date: EventDate;
          inventory: DailyProductInventory[];
        }>(`/api/reserve/${dateId}`);
        setEventDate(data.event_date);
        setInventories(data.inventory);
      } catch (err) {
        console.error("Reserve data load error:", err);
        setLoadError("商品情報の取得に失敗しました");
      } finally {
        setLoading(false);
      }
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

  /**
   * The + button stays tappable once the cap is reached, so the tap can
   * explain itself. A `disabled` button fires no event at all, which reads
   * as a broken screen rather than as "there is no more stock".
   */
  const handleCapAttempt = useCallback(
    (productId: string, target: HTMLElement) => {
      setCapNoticeId(productId);

      if (capNoticeTimer.current) clearTimeout(capNoticeTimer.current);
      capNoticeTimer.current = setTimeout(() => setCapNoticeId(null), 4000);

      // Retrigger the nudge even while it is already running.
      const card = target.closest<HTMLElement>("[data-product-card]");
      if (card) {
        card.classList.remove("animate-cap-nudge");
        void card.offsetWidth;
        card.classList.add("animate-cap-nudge");
      }
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
      <main className="min-h-screen bg-paper flex items-center justify-center">
        <div className="animate-pulse text-zinc-400">読み込み中...</div>
      </main>
    );
  }

  if (loadError || !eventDate) {
    return (
      <main className="min-h-screen bg-paper flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-zinc-600 mb-4">
            {loadError || "受取日が見つかりませんでした"}
          </p>
          <Link
            href="/"
            className="text-sm text-brand-600 underline underline-offset-4"
          >
            トップへ戻る
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-paper pb-28">
      {/* Header */}
      <div className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/"
            className="text-zinc-400 hover:text-zinc-600 transition-colors"
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
          <h1 className="text-lg font-bold text-zinc-800">
            商品を選ぶ
          </h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        {/* Selected Date Banner */}
        {eventDate && (
          <div className="bg-brand-50 border border-brand-200 rounded-2xl p-4 mb-6 flex items-center gap-3">
            <div className="w-12 h-12 bg-brand-500 text-white rounded-xl flex items-center justify-center text-lg font-bold shrink-0">
              {new Date(eventDate.pickup_date + "T00:00:00").getDate()}
            </div>
            <div>
              <p className="text-xs text-brand-500 font-medium">受取日</p>
              <p className="text-brand-800 font-bold text-lg">
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
            const atCap = qty >= remaining;
            // Only call out the count when it is actually scarce; "残り20個"
            // is noise that dulls the warning when it matters.
            const isLowStock = remaining > 0 && remaining <= inv.warning_threshold;

            return (
              <div
                key={inv.id}
                data-product-card
                onAnimationEnd={(e) =>
                  e.currentTarget.classList.remove("animate-cap-nudge")
                }
                className={`bg-white rounded-2xl border border-zinc-200 overflow-hidden transition-opacity ${
                  isSoldOut ? "opacity-50" : ""
                }`}
              >
                <div className="flex gap-4 p-4">
                  {/* Product Image */}
                  <div className="w-24 h-24 rounded-xl bg-zinc-100 overflow-hidden shrink-0 relative">
                    {product.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.image_url}
                        alt={product.name}
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-zinc-300">
                        <Icon name="coffee" className="w-8 h-8" />
                      </div>
                    )}
                    {isSoldOut && (
                      <div className="absolute inset-0 bg-zinc-900/50 flex items-center justify-center">
                        <span className="text-white text-xs font-bold bg-zinc-800 px-2 py-1 rounded">
                          SOLD OUT
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Product Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-zinc-800 text-sm mb-1 truncate">
                      {product.name}
                    </h3>
                    {product.description && (
                      <p className="text-xs text-zinc-400 mb-2 line-clamp-2">
                        {product.description}
                      </p>
                    )}
                    <p className="text-brand-600 font-bold text-base">
                      {formatPrice(product.price)}
                    </p>
                    {!isSoldOut && isLowStock && (
                      <div className="mt-1.5">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          残り {remaining} 個
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Quantity Selector */}
                {!isSoldOut && (
                  <>
                  <div className="border-t border-zinc-100 px-4 py-3 flex items-center justify-between bg-paper/50">
                    <span
                      className={
                        atCap
                          ? "text-xs font-bold text-red-700"
                          : "text-xs text-zinc-500"
                      }
                    >
                      {atCap ? "上限に達しました" : "数量"}
                    </span>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() =>
                          updateQuantity(product.id, -1, remaining)
                        }
                        disabled={qty === 0}
                        className={`w-9 h-9 rounded-full flex items-center justify-center text-lg font-medium transition-colors ${
                          qty === 0
                            ? "bg-zinc-200 text-zinc-400 cursor-not-allowed"
                            : "bg-brand-100 text-brand-700 hover:bg-brand-200 active:bg-brand-300"
                        }`}
                      >
                        -
                      </button>
                      <span className="w-8 text-center font-bold text-zinc-800 text-lg tabular-nums">
                        {qty}
                      </span>
                      <button
                        type="button"
                        aria-label="1つ増やす"
                        /*
                          `aria-disabled` はここでは付けない。この状態のボタンは
                          押せば理由を返すので「無効」ではないし、無効と伝えると
                          読み上げソフトや自動操作からは押せなくなり、肝心の説明に
                          たどり着けなくなる。見た目で止まっていることは分かる。
                        */
                        onClick={(e) => {
                          if (atCap) {
                            handleCapAttempt(product.id, e.currentTarget);
                            return;
                          }
                          updateQuantity(product.id, 1, remaining);
                        }}
                        className={`w-9 h-9 rounded-full flex items-center justify-center text-lg font-medium transition-colors ${
                          atCap
                            ? "bg-zinc-200 text-zinc-400"
                            : "bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700"
                        }`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  {atCap && capNoticeId === product.id && (
                    <div
                      role="status"
                      className="flex items-start gap-2 border-t border-red-100 bg-red-50 px-4 py-2.5 text-xs font-medium leading-relaxed text-red-700"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5 shrink-0 mt-0.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.2}
                        strokeLinecap="round"
                      >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 8v5" />
                        <path d="M12 16.5v.01" />
                      </svg>
                      <span>
                        在庫が残り{remaining}個のため、これ以上は追加できません
                      </span>
                    </div>
                  )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {inventories.length === 0 && (
          <div className="text-center py-12 text-zinc-400">
            <Icon name="box" className="w-10 h-10 mx-auto mb-3 text-zinc-300" />
            <p>この日の商品はまだ登録されていません</p>
          </div>
        )}
      </div>

      {/* Floating Cart Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-20">
        <div className="max-w-lg mx-auto">
          <div className="bg-white border-t border-zinc-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] px-4 py-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <span className="text-xs text-zinc-400">合計</span>
                <span className="text-zinc-400 mx-1">|</span>
                <span className="text-xs text-zinc-500">
                  {totalCount} 点
                </span>
              </div>
              <p className="text-xl font-bold text-brand-700">
                {formatPrice(totalAmount)}
              </p>
            </div>
            <button
              onClick={handleProceed}
              disabled={totalCount === 0}
              className={`w-full py-3.5 rounded-2xl font-bold text-base transition-colors ${
                totalCount === 0
                  ? "bg-zinc-200 text-zinc-400 cursor-not-allowed"
                  : "bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white shadow-lg shadow-brand-600/20"
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
