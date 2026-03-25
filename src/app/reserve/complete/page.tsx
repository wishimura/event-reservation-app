"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Order, OrderItem } from "@/lib/types";
import { formatDate, formatPrice } from "@/lib/utils";

interface OrderWithItems extends Order {
  items?: OrderItem[];
  pickup_location?: string;
}

export default function CompletePage() {
  const router = useRouter();
  const [order, setOrder] = useState<OrderWithItems | null>(null);

  useEffect(() => {
    const data = localStorage.getItem("lastOrder");
    if (!data) {
      router.push("/");
      return;
    }
    setOrder(JSON.parse(data) as OrderWithItems);
  }, [router]);

  if (!order) {
    return (
      <main className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="animate-pulse text-stone-400">読み込み中...</div>
      </main>
    );
  }

  const pickupDate = order.event_date?.pickup_date ?? "";

  return (
    <main className="min-h-screen bg-stone-50">
      {/* Success Header */}
      <div className="bg-gradient-to-br from-amber-600 via-amber-700 to-amber-800 text-white">
        <div className="max-w-lg mx-auto px-4 pt-12 pb-10 text-center relative overflow-hidden">
          {/* Decorative circles */}
          <div className="absolute top-4 left-8 w-3 h-3 bg-amber-400/30 rounded-full" />
          <div className="absolute top-16 right-12 w-2 h-2 bg-amber-300/40 rounded-full" />
          <div className="absolute bottom-8 left-16 w-2 h-2 bg-amber-400/20 rounded-full" />
          <div className="absolute top-8 right-24 w-4 h-4 bg-amber-300/20 rounded-full" />
          <div className="absolute bottom-12 right-8 w-3 h-3 bg-amber-400/30 rounded-full" />
          <div className="absolute top-20 left-24 w-2 h-2 bg-white/20 rounded-full" />

          <div className="relative z-10">
            <div className="w-20 h-20 bg-white/20 rounded-full mx-auto mb-4 flex items-center justify-center">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-10 w-10 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold mb-2">
              ご予約ありがとうございます！
            </h1>
            <p className="text-amber-100/80 text-sm">
              ご注文が確定されました
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 -mt-4">
        {/* Order Number Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-5 mb-5 text-center">
          <p className="text-xs text-stone-400 font-medium mb-1">
            注文番号
          </p>
          <p className="text-2xl font-bold text-stone-800 tracking-wider font-mono">
            {order.order_number}
          </p>
          <p className="text-xs text-stone-400 mt-2">
            受取時にこの番号をお伝えください
          </p>
        </div>

        {/* Pickup Date */}
        {pickupDate && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-5 text-center">
            <p className="text-xs text-amber-600 font-medium mb-1">
              受取日
            </p>
            <p className="text-2xl font-bold text-amber-900">
              {formatDate(pickupDate)}
            </p>
          </div>
        )}

        {/* Order Summary */}
        <div className="bg-white rounded-2xl border border-stone-200 overflow-hidden mb-5">
          <div className="px-4 py-3 border-b border-stone-100">
            <h2 className="font-bold text-stone-700 text-sm">
              ご注文内容
            </h2>
          </div>
          <div className="divide-y divide-stone-100">
            {order.items?.map((item) => (
              <div
                key={item.id || item.product_id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-stone-800 truncate">
                    {item.product_name_snapshot}
                  </p>
                  <p className="text-xs text-stone-400">
                    {formatPrice(item.unit_price)} x {item.quantity}
                  </p>
                </div>
                <p className="font-semibold text-stone-700 text-sm shrink-0 ml-3">
                  {formatPrice(item.subtotal)}
                </p>
              </div>
            ))}
          </div>
          <div className="border-t border-stone-200 px-4 py-4 flex items-center justify-between bg-stone-50/50">
            <span className="font-bold text-stone-600">合計</span>
            <span className="text-xl font-bold text-amber-800">
              {formatPrice(order.total_amount)}
            </span>
          </div>
        </div>

        {/* Pickup Instructions */}
        <div className="bg-white rounded-2xl border border-stone-200 p-5 mb-5">
          <h2 className="font-bold text-stone-700 text-sm mb-3">
            受取について
          </h2>
          <div className="space-y-3">
            {order.pickup_location && (
              <div className="flex items-start gap-2.5">
                <span className="text-amber-600">&#128205;</span>
                <div>
                  <p className="text-xs text-stone-400 mb-0.5">受取場所</p>
                  <p className="text-stone-800 text-sm font-medium">
                    {order.pickup_location}
                  </p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-2.5">
              <span className="text-amber-600">&#128176;</span>
              <div>
                <p className="text-xs text-stone-400 mb-0.5">お支払い</p>
                <p className="text-stone-800 text-sm font-medium">
                  現金払い（受取時にお支払い）
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="text-amber-600">&#128221;</span>
              <div>
                <p className="text-xs text-stone-400 mb-0.5">ご注意</p>
                <p className="text-stone-600 text-sm">
                  受取日当日にご来店の上、注文番号をスタッフにお伝えください。
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Payment Notice */}
        <div className="bg-stone-100 rounded-2xl p-4 mb-5">
          <p className="text-xs text-stone-500 text-center leading-relaxed">
            確認メールが送信されました。メールが届かない場合はお問い合わせください。
          </p>
        </div>

        {/* Back to Top */}
        <div className="pb-10">
          <Link
            href="/"
            className="block w-full text-center bg-white border border-stone-200 text-stone-700 font-semibold py-3.5 rounded-2xl text-sm hover:bg-stone-50 transition-colors"
          >
            トップに戻る
          </Link>
        </div>
      </div>
    </main>
  );
}
