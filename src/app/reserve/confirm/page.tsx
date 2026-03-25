"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { CartItem, Event } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { formatDate, formatPrice } from "@/lib/utils";

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

  useEffect(() => {
    const cartData = localStorage.getItem("cart");
    const dateData = localStorage.getItem("selectedDate");

    if (!cartData || !dateData) {
      router.push("/reserve");
      return;
    }

    setCart(JSON.parse(cartData) as CartItem[]);
    setSelectedDate(JSON.parse(dateData));

    async function fetchEvent() {
      const { data } = await supabase
        .from("events")
        .select("*")
        .eq("is_active", true)
        .single<Event>();
      if (data) setEvent(data);
    }
    fetchEvent();
  }, [router]);

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
          payment_method: "cash",
          items: cart.map((item) => ({
            product_id: item.product.id,
            product_name_snapshot: item.product.name,
            unit_price: item.product.price,
            quantity: item.quantity,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "注文に失敗しました。もう一度お試しください。");
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
                    <Image
                      src={item.product.image_url}
                      alt={item.product.name}
                      fill
                      className="object-cover"
                      sizes="56px"
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
          <div className="space-y-3">
            {/* Cash - selected */}
            <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-amber-500 bg-amber-50">
              <div className="w-5 h-5 rounded-full border-2 border-amber-600 flex items-center justify-center">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-stone-800">
                  現金払い
                </p>
                <p className="text-xs text-stone-500">
                  受取時にお支払い
                </p>
              </div>
              <span className="text-lg">&#128176;</span>
            </div>

            {/* Credit Card - disabled */}
            <div className="flex items-center gap-3 p-3 rounded-xl border border-stone-200 bg-stone-50 opacity-60">
              <div className="w-5 h-5 rounded-full border-2 border-stone-300" />
              <div className="flex-1">
                <p className="text-sm font-medium text-stone-400">
                  クレジットカード
                </p>
              </div>
              <span className="text-xs font-semibold bg-stone-200 text-stone-500 px-2 py-0.5 rounded-full">
                Coming Soon
              </span>
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={submitting}
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
      </div>
    </main>
  );
}
