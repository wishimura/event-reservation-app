"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CartItem, Event } from "@/lib/types";
import { fetchJson } from "@/lib/api-client";
import { formatDate, formatPrice } from "@/lib/utils";
import { SiteFooter } from "@/components/SiteFooter";

type TokenResult =
  | { status: "OK"; token: string }
  | { status: "Error" | "Invalid"; errors?: Array<{ message?: string }> };

export default function ConfirmPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedDate, setSelectedDate] = useState<{
    id: string;
    pickup_date: string;
  } | null>(null);
  const [event, setEvent] = useState<Event | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Card payment is on only when the shop's Square credentials are configured;
  // otherwise the reservation is settled at the counter, as before.
  const [payByCard, setPayByCard] = useState<boolean | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [cardError, setCardError] = useState("");
  const cardRef = useRef<{ tokenize: () => Promise<TokenResult> } | null>(null);

  useEffect(() => {
    const cartData = localStorage.getItem("cart");
    const dateData = localStorage.getItem("selectedDate");

    if (!cartData || !dateData) {
      router.push("/");
      return;
    }

    setCart(JSON.parse(cartData) as CartItem[]);
    setSelectedDate(JSON.parse(dateData));

    async function fetchEvent() {
      try {
        setEvent(await fetchJson<Event>("/api/events"));
      } catch (err) {
        console.error("Event load error:", err);
      }
    }
    fetchEvent();
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    async function setUpPayment() {
      try {
        const config = await fetchJson<{
          enabled: boolean;
          applicationId: string | null;
          locationId: string | null;
        }>("/api/payments/config");

        if (cancelled) return;
        setPayByCard(config.enabled);

        if (!config.enabled || !config.applicationId || !config.locationId) {
          return;
        }

        const { payments } = await import("@square/web-sdk");
        const sq = await payments(config.applicationId, config.locationId);
        if (cancelled || !sq) {
          setCardError("決済フォームを読み込めませんでした");
          return;
        }

        const card = await sq.card();
        await card.attach("#square-card");
        if (cancelled) {
          card.destroy();
          return;
        }

        cardRef.current = card as unknown as {
          tokenize: () => Promise<TokenResult>;
        };
        setCardReady(true);
      } catch (err) {
        console.error("Square setup error:", err);
        if (!cancelled) {
          setCardError(
            "決済フォームの読み込みに失敗しました。ページを再読み込みしてください。"
          );
        }
      }
    }

    setUpPayment();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalAmount = cart.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0
  );

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "お名前を入力してください";
    if (!email.trim()) {
      errs.email = "メールアドレスを入力してください";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errs.email = "正しいメールアドレスを入力してください";
    }
    if (!phone.trim()) {
      errs.phone = "電話番号を入力してください";
    } else if (!/^[0-9\-+() ]{10,}$/.test(phone)) {
      errs.phone = "正しい電話番号を入力してください";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit() {
    if (!validate() || !event || !selectedDate) return;

    setSubmitting(true);
    setCardError("");

    let paymentSourceId: string | undefined;

    // Tokenise the card before touching the server, so a typo in the card
    // number never reaches the point of holding stock.
    if (payByCard) {
      if (!cardRef.current) {
        setCardError("決済フォームがまだ読み込まれていません");
        setSubmitting(false);
        return;
      }
      try {
        const result = await cardRef.current.tokenize();
        if (result.status !== "OK") {
          setCardError(
            result.errors?.[0]?.message ??
              "カード情報をご確認のうえ、もう一度お試しください。"
          );
          setSubmitting(false);
          return;
        }
        paymentSourceId = result.token;
      } catch (err) {
        console.error("Tokenize error:", err);
        setCardError("カード情報の確認に失敗しました。もう一度お試しください。");
        setSubmitting(false);
        return;
      }
    }

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: event.id,
          event_date_id: selectedDate.id,
          customer_name: name.trim(),
          customer_email: email.trim(),
          customer_phone: phone.trim(),
          payment_method: payByCard ? "credit_card" : "cash",
          payment_source_id: paymentSourceId,
          items: cart.map((item) => ({
            product_id: item.product.id,
            product_name_snapshot: item.product.name,
            unit_price: item.product.price,
            quantity: item.quantity,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const details = Array.isArray(data.details) ? data.details : [];
        alert(
          [data.error || "注文に失敗しました。もう一度お試しください。", ...details].join(
            "\n"
          )
        );
        setSubmitting(false);
        return;
      }

      const order = await res.json();
      localStorage.setItem("lastOrder", JSON.stringify(order));
      localStorage.removeItem("cart");
      router.push("/reserve/complete");
    } catch {
      alert("エラーが発生しました。もう一度お試しください。");
      setSubmitting(false);
    }
  }

  if (!selectedDate || cart.length === 0) {
    return (
      <main className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="animate-pulse text-stone-400">読み込み中...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 pb-8">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
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
          </button>
          <h1 className="text-lg font-bold text-stone-800">
            ご注文の確認
          </h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
        {/* Pickup Date */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-center">
          <p className="text-xs text-amber-600 font-medium mb-1">受取日</p>
          <p className="text-2xl font-bold text-amber-900">
            {formatDate(selectedDate.pickup_date)}
          </p>
        </div>

        {/* Product List */}
        <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-stone-100">
            <h2 className="font-bold text-stone-700 text-sm">
              ご注文内容
            </h2>
          </div>
          <div className="divide-y divide-stone-100">
            {cart.map((item) => (
              <div key={item.product.id} className="flex items-center gap-3 p-4">
                <div className="w-14 h-14 rounded-lg bg-stone-100 overflow-hidden shrink-0 relative">
                  {item.product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.product.image_url}
                      alt={item.product.name}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xl text-stone-300">
                      &#9749;
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-stone-800 truncate">
                    {item.product.name}
                  </p>
                  <p className="text-xs text-stone-400">
                    {formatPrice(item.product.price)} x {item.quantity}
                  </p>
                </div>
                <p className="font-bold text-stone-800 text-sm shrink-0">
                  {formatPrice(item.product.price * item.quantity)}
                </p>
              </div>
            ))}
          </div>
          <div className="border-t border-stone-200 px-4 py-4 flex items-center justify-between bg-stone-50/50">
            <span className="font-bold text-stone-600">合計</span>
            <span className="text-xl font-bold text-amber-800">
              {formatPrice(totalAmount)}
            </span>
          </div>
        </div>

        {/* Pickup Info */}
        {event && (
          <div className="bg-white rounded-2xl border border-stone-200 p-4">
            <h2 className="font-bold text-stone-700 text-sm mb-3">
              受取情報
            </h2>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-amber-600 text-sm">&#128205;</span>
                <div>
                  <p className="text-xs text-stone-400">受取場所</p>
                  <p className="text-stone-800 text-sm font-medium">
                    {event.pickup_location}
                  </p>
                </div>
              </div>
              {event.reservation_note && (
                <div className="flex items-start gap-2">
                  <span className="text-amber-600 text-sm">&#128221;</span>
                  <div>
                    <p className="text-xs text-stone-400">備考</p>
                    <p className="text-stone-600 text-sm whitespace-pre-line">
                      {event.reservation_note}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Customer Info Form */}
        <div className="bg-white rounded-2xl border border-stone-200 p-4">
          <h2 className="font-bold text-stone-700 text-sm mb-4">
            お客様情報
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-stone-500 mb-1.5 font-medium">
                お名前 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="山田 太郎"
                className={`w-full px-4 py-3 rounded-xl border text-sm bg-stone-50 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent ${
                  errors.name ? "border-red-300" : "border-stone-200"
                }`}
              />
              {errors.name && (
                <p className="text-red-500 text-xs mt-1">{errors.name}</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1.5 font-medium">
                メールアドレス <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="taro@example.com"
                className={`w-full px-4 py-3 rounded-xl border text-sm bg-stone-50 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent ${
                  errors.email ? "border-red-300" : "border-stone-200"
                }`}
              />
              {errors.email && (
                <p className="text-red-500 text-xs mt-1">{errors.email}</p>
              )}
            </div>
            <div>
              <label className="block text-xs text-stone-500 mb-1.5 font-medium">
                電話番号 <span className="text-red-400">*</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="090-1234-5678"
                className={`w-full px-4 py-3 rounded-xl border text-sm bg-stone-50 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent ${
                  errors.phone ? "border-red-300" : "border-stone-200"
                }`}
              />
              {errors.phone && (
                <p className="text-red-500 text-xs mt-1">{errors.phone}</p>
              )}
            </div>
          </div>
        </div>

        {/* Payment Method */}
        <div className="bg-white rounded-2xl border border-stone-200 p-4">
          <h2 className="font-bold text-stone-700 text-sm mb-4">
            お支払い方法
          </h2>
          {payByCard === null && (
            <p className="text-sm text-stone-400">読み込み中...</p>
          )}

          {payByCard === false && (
            <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-amber-500 bg-amber-50">
              <div className="w-5 h-5 rounded-full border-2 border-amber-600 flex items-center justify-center">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-stone-800">現地払い</p>
                <p className="text-xs text-stone-500">受取時にお支払い</p>
              </div>
              <span className="text-lg">&#128176;</span>
            </div>
          )}

          {payByCard === true && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-amber-500 bg-amber-50">
                <div className="w-5 h-5 rounded-full border-2 border-amber-600 flex items-center justify-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-stone-800">
                    クレジットカード
                  </p>
                  <p className="text-xs text-stone-500">
                    ご予約の確定時にお支払いが完了します
                  </p>
                </div>
                <span className="text-lg">&#128179;</span>
              </div>

              <div
                id="square-card"
                className="rounded-xl border border-stone-200 bg-white p-3 min-h-[92px]"
              />

              {!cardReady && !cardError && (
                <p className="text-xs text-stone-400">
                  決済フォームを読み込んでいます...
                </p>
              )}

              {cardError && (
                <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                  {cardError}
                </p>
              )}

              <p className="text-xs leading-relaxed text-stone-400">
                カード情報は決済代行会社（Square）が直接受け取ります。当店のサーバーには保存されません。
              </p>
            </div>
          )}
        </div>

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={submitting || payByCard === null || (payByCard && !cardReady)}
          className={`w-full py-4 rounded-2xl font-bold text-lg transition-colors ${
            submitting
              ? "bg-stone-300 text-stone-500 cursor-not-allowed"
              : "bg-amber-700 hover:bg-amber-800 active:bg-amber-900 text-white shadow-lg shadow-amber-700/20"
          }`}
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <svg
                className="animate-spin h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              処理中...
            </span>
          ) : (
            "注文を確定する"
          )}
        </button>

        <p className="text-center text-xs text-stone-400">
          注文確定後、確認メールが送信されます
        </p>

        <SiteFooter />
      </div>
    </main>
  );
}
