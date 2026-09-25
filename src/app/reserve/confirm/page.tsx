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

type PaymentRequest = {
  countryCode: string;
  currencyCode: string;
  total: { amount: string; label: string };
};

/** Apple Pay and Google Pay expose the same surface to us. */
type SquareWallet = {
  attach: (selector: string) => Promise<void>;
  tokenize: () => Promise<TokenResult>;
  destroy?: () => Promise<void>;
};

/** Whether a wallet button can be shown on this device. */
type WalletStatus = "pending" | "ready" | "unavailable";

/** The slice of the Square Payments object we use beyond the card form. */
type SquarePayments = {
  verifyBuyer: (
    source: string,
    details: {
      amount: string;
      currencyCode: string;
      intent: "CHARGE";
      billingContact: {
        givenName?: string;
        familyName?: string;
        email?: string;
        phone?: string;
        countryCode?: string;
      };
    }
  ) => Promise<{ token: string } | null>;
  paymentRequest: (config: PaymentRequest) => PaymentRequest;
  applePay: (request: PaymentRequest) => Promise<SquareWallet | null>;
  googlePay: (request: PaymentRequest) => Promise<SquareWallet | null>;
};

/**
 * Wallet setup can hang — Apple Pay on a device with an empty Wallet never
 * settles. Cap it so a stuck wallet never holds up the card form.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * Square takes the buyer's name in two fields. Japanese names are written
 * 「姓 名」, so the first chunk is the family name. A name with no separator
 * goes in whole as the given name, which is what Square asks for mononyms.
 */
function splitName(fullName: string): {
  givenName: string;
  familyName?: string;
} {
  // \s covers the full-width space Japanese names are usually typed with.
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return { givenName: fullName.trim() };
  return { familyName: parts[0], givenName: parts.slice(1).join(" ") };
}

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
  const [paymentsReady, setPaymentsReady] = useState(false);
  const [applePayStatus, setApplePayStatus] = useState<WalletStatus>("pending");
  const [googlePayStatus, setGooglePayStatus] =
    useState<WalletStatus>("pending");
  const cardRef = useRef<{ tokenize: () => Promise<TokenResult> } | null>(null);
  const paymentsRef = useRef<SquarePayments | null>(null);
  const applePayRef = useRef<SquareWallet | null>(null);
  const googlePayRef = useRef<SquareWallet | null>(null);

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

        paymentsRef.current = sq as unknown as SquarePayments;
        setPaymentsReady(true);

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

  /**
   * Apple Pay / Google Pay.
   *
   * Set up separately from the card form because the wallet sheet has to be
   * told the amount up front, and the cart is only known after it is read back
   * from storage. Neither wallet needs any credential of its own: they run on
   * the same Square application and location as the card form.
   *
   * A wallet the device cannot offer — no Wallet card, wrong browser — simply
   * reports itself unavailable and its button stays hidden. The card form is
   * never blocked by it.
   */
  useEffect(() => {
    const payments = paymentsRef.current;
    if (!paymentsReady || !payments || totalAmount <= 0) return;

    let cancelled = false;

    const request = payments.paymentRequest({
      countryCode: "JP",
      currencyCode: "JPY",
      // The yen has no fractional denomination, so no decimal point.
      total: { amount: String(totalAmount), label: "お支払い金額" },
    });

    async function setUpWallet(
      create: () => Promise<SquareWallet | null>,
      containerId: string,
      ref: React.RefObject<SquareWallet | null>,
      setStatus: (status: WalletStatus) => void
    ) {
      try {
        const wallet = await withTimeout(create(), 3000);
        if (!wallet || cancelled) {
          setStatus("unavailable");
          await wallet?.destroy?.();
          return;
        }
        await wallet.attach(`#${containerId}`);
        if (cancelled) {
          await wallet.destroy?.();
          return;
        }
        ref.current = wallet;
        setStatus("ready");
      } catch {
        // Square throws when the wallet is not supported here. That is the
        // normal case on most desktops, not an error worth showing.
        setStatus("unavailable");
      }
    }

    setUpWallet(
      () => payments.applePay(request),
      "square-apple-pay",
      applePayRef,
      setApplePayStatus
    );
    setUpWallet(
      () => payments.googlePay(request),
      "square-google-pay",
      googlePayRef,
      setGooglePayStatus
    );

    return () => {
      cancelled = true;
      applePayRef.current?.destroy?.().catch(() => {});
      googlePayRef.current?.destroy?.().catch(() => {});
      applePayRef.current = null;
      googlePayRef.current = null;
    };
  }, [paymentsReady, totalAmount]);

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

  /**
   * Sends the reservation. The payment token is already in hand by this
   * point — whether it came from the card form or from a wallet — so all
   * that is left is to hand it to the server.
   */
  async function placeOrder(
    paymentSourceId?: string,
    verificationToken?: string
  ) {
    if (!event || !selectedDate) return;

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
          verification_token: verificationToken,
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

  /** The card form: tokenise, verify the buyer, then order. */
  async function handleSubmit() {
    if (!validate() || !event || !selectedDate) return;

    setSubmitting(true);
    setCardError("");

    let paymentSourceId: string | undefined;
    let verificationToken: string | undefined;

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

      // 3-D Secure. The card issuer may put a challenge screen in front of the
      // customer here, so this has to happen in the browser, before the order
      // reaches the server. Square declines the payment outright when the
      // issuer asks for a challenge and no verification token comes with it.
      try {
        const verification = await paymentsRef.current?.verifyBuyer(
          paymentSourceId,
          {
            // The yen has no fractional denomination, so "1500" — not "1500.00".
            amount: String(totalAmount),
            currencyCode: "JPY",
            intent: "CHARGE",
            billingContact: {
              ...splitName(name),
              email: email.trim(),
              phone: phone.trim(),
              countryCode: "JP",
            },
          }
        );

        // Square returns nothing when the issuer asks for no verification at
        // all. That is a normal outcome, and the charge goes ahead without one.
        verificationToken = verification?.token;
      } catch (err) {
        console.error("verifyBuyer error:", err);
        setCardError(
          "カード会社の本人認証が完了しませんでした。もう一度お試しください。"
        );
        setSubmitting(false);
        return;
      }
    }

    await placeOrder(paymentSourceId, verificationToken);
  }

  /**
   * Apple Pay / Google Pay.
   *
   * No 3-D Secure step here: the wallet has already authenticated the buyer
   * on the device, and Square treats a wallet token as verified. Running
   * verifyBuyer() on one would be rejected.
   */
  async function handleWalletPay(wallet: SquareWallet | null) {
    if (!wallet || submitting) return;
    // Validated before the sheet opens, so the customer is not asked to pay
    // only to be sent back to a missing field afterwards.
    if (!validate() || !event || !selectedDate) return;

    setSubmitting(true);
    setCardError("");

    let token: string;
    try {
      const result = await wallet.tokenize();
      if (result.status !== "OK") {
        // Closing the sheet lands here too, which is not worth an error.
        setSubmitting(false);
        return;
      }
      token = result.token;
    } catch (err) {
      console.error("Wallet tokenize error:", err);
      setCardError("お支払いを完了できませんでした。もう一度お試しください。");
      setSubmitting(false);
      return;
    }

    await placeOrder(token);
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

              {/*
                The wallet containers stay mounted while Square decides
                whether the device can offer them — it attaches to a laid-out
                element — and are hidden only once the answer is no. Empty,
                they take up no room, so nothing flickers.
              */}
              <div
                className={`space-y-2 ${
                  applePayStatus === "unavailable" &&
                  googlePayStatus === "unavailable"
                    ? "hidden"
                    : ""
                }`}
              >
                <div
                  id="square-apple-pay"
                  onClick={() => handleWalletPay(applePayRef.current)}
                  className={`h-11 cursor-pointer ${
                    applePayStatus === "unavailable" ? "hidden" : ""
                  }`}
                />
                <div
                  id="square-google-pay"
                  onClick={() => handleWalletPay(googlePayRef.current)}
                  className={`h-11 cursor-pointer ${
                    googlePayStatus === "unavailable" ? "hidden" : ""
                  }`}
                />
              </div>

              {(applePayStatus === "ready" || googlePayStatus === "ready") && (
                <div className="flex items-center gap-3 py-1">
                  <div className="h-px flex-1 bg-stone-200" />
                  <span className="text-xs text-stone-400">
                    またはカード番号を入力
                  </span>
                  <div className="h-px flex-1 bg-stone-200" />
                </div>
              )}

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
                <br />
                ご注文の確定時に、カード会社の本人認証（3Dセキュア）画面が表示される場合があります。
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
