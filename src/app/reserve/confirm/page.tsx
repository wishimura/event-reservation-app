"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CartItem, Event } from "@/lib/types";
import { fetchJson } from "@/lib/api-client";
import { formatDate, formatPrice } from "@/lib/utils";
import { pickupDateLabel } from "@/lib/tax";
import type { DiningStyle } from "@/lib/types";
import { SiteFooter } from "@/components/SiteFooter";
import { Icon } from "@/components/Icon";

type TokenResult =
  | { status: "OK"; token: string }
  | { status: "Error" | "Invalid"; errors?: Array<{ message?: string }> };

/** A label for one attempt at an order, unique enough to tell attempts apart. */
function newRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Sends the order, and sends it again if the connection failed outright.
 *
 * A phone on shop wifi drops requests, and the customer cannot tell a
 * request that never arrived from one whose answer was lost on the way back.
 * Both are safe to repeat: the order carries an id the server recognises, so
 * a second copy is answered with the first one's result rather than charged
 * again. Only a dead connection is retried — an answer, of any kind, is the
 * server's and is passed straight back.
 */
async function postOrder(payload: Record<string, unknown>): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1200));
    }
  }

  throw lastError;
}

/**
 * この端末が覚えているカード。
 *
 * `/api/saved-card` が返すぶんだけ。カード番号も有効期限の全体も来ません。
 * `square_card_id` が入っているのは本人認証に要るからで、これだけでは
 * 決済できません（決済はサーバーが Cookie から引き直します）。
 */
type SavedCard = {
  brand: string;
  last4: string;
  exp_month: number | null;
  exp_year: number | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  square_card_id: string;
};

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
};

/**
 * Square takes the buyer's name in two fields. Japanese names are written
 * 「姓 名」, so the first chunk is the family name. A name with no separator
 * goes in whole as the given name, which is what Square asks for mononyms.
 */
/**
 * Square のブランド名を、お客様が自分のカードと見比べられる形に。
 *
 * 返ってくるのは `AMERICAN_EXPRESS` のような定数です。知らないものは
 * そのまま出すより伏せたほうがよいので、空で返して「カード」と出します。
 */
function cardBrandLabel(brand: string): string {
  const labels: Record<string, string> = {
    VISA: "Visa",
    MASTERCARD: "Mastercard",
    AMERICAN_EXPRESS: "American Express",
    JCB: "JCB",
    DISCOVER: "Discover",
    DISCOVER_DINERS: "Diners Club",
    CHINA_UNIONPAY: "UnionPay",
  };
  return labels[brand] ?? "カード";
}

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
  const [diningStyle, setDiningStyle] = useState<DiningStyle | "">("");
  const [submitting, setSubmitting] = useState(false);
  /**
   * True only while the order is with the server — taking the money and
   * holding the stock. Deliberately not set during 3-D Secure: Square puts
   * its own challenge window on the screen there, and covering it would
   * leave the customer unable to pay at all.
   */
  const [placing, setPlacing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Card payment is on only when the shop's Square credentials are configured;
  // otherwise the reservation is settled at the counter, as before.
  const [payByCard, setPayByCard] = useState<boolean | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const [cardError, setCardError] = useState("");
  /** ボタンのすぐ上に出す要約。押した場所で反応を返すため。 */
  const [formError, setFormError] = useState("");
  /** 一度でも「注文を確定する」を押したか。押すまでは赤くしない。 */
  const [attempted, setAttempted] = useState(false);
  /** 催しの情報を取れずに諦めたか。待てば直る、と言わないために見る。 */
  const [loadFailed, setLoadFailed] = useState(false);
  const [paymentsReady, setPaymentsReady] = useState(false);

  /* ---------------- 覚えてあるカード ---------------- */

  /** この端末が覚えているカード。無ければ null。 */
  const [savedCard, setSavedCard] = useState<SavedCard | null>(null);
  /** 覚えてあるカードで払うか。別のカードを選ぶと false になる。 */
  const [useSavedCard, setUseSavedCard] = useState(false);
  /** 今回のカードを次回のために覚えるか。 */
  const [rememberCard, setRememberCard] = useState(true);
  const [forgettingCard, setForgettingCard] = useState(false);
  /**
   * One id for this customer's attempt to buy this basket.
   *
   * It goes with every send of the order, so if the connection drops in the
   * second the card is charged and the order is sent again, the server knows
   * the two are the same attempt and does not charge twice. Made once for the
   * life of the page, which is exactly as long as the attempt lasts.
   */
  const requestIdRef = useRef<string>("");
  if (!requestIdRef.current) requestIdRef.current = newRequestId();

  const cardRef = useRef<{ tokenize: () => Promise<TokenResult> } | null>(null);
  const paymentsRef = useRef<SquarePayments | null>(null);

  useEffect(() => {
    const cartData = localStorage.getItem("cart");
    const dateData = localStorage.getItem("selectedDate");

    if (!cartData || !dateData) {
      router.push("/");
      return;
    }

    setCart(JSON.parse(cartData) as CartItem[]);
    setSelectedDate(JSON.parse(dateData));

    /*
      催しの情報が取れないと、お客様は**いつまで経っても注文できません**。
      `ready()` がここを見ていて、取れていないあいだは「読み込み中です」と
      言い続けるからです。以前は一度失敗したらそれきりで、再試行も記録も
      ありませんでした。待っても直らないのに「待ってください」と出続ける、
      いちばん意地の悪い壊れ方です。

      少し間を置いて3回まで試し、それでも駄目なら、待てば直るかのような
      言い方をやめて、読み直していただくようお願いします。そして残します。
    */
    async function fetchEvent() {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          setEvent(await fetchJson<Event>("/api/events"));
          return;
        } catch (err) {
          console.error(`Event load error (attempt ${attempt}):`, err);
          if (attempt === 3) {
            setLoadFailed(true);
            reportIncident("data", "load", "催しの情報を取得できませんでした", err);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        }
      }
    }
    fetchEvent();
  }, [router]);

  /**
   * 決済にたどり着く前に転んだことを、お店に知らせる。
   *
   * この時点ではまだ金額もご連絡先も決まっていません。分かっていることだけ
   * 送ります。**この失敗はサーバーに何も残らない**ので、送らなければ誰も
   * 気づけません（2026-10-30 のお申し出がまさにこれでした）。
   */
  function reportIncident(
    area: "payment" | "data",
    stage: "card_form" | "load",
    message: string,
    err: unknown
  ) {
    try {
      void fetch("/api/incident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          area,
          stage,
          outcome: "error",
          message,
          path: "/reserve/confirm",
          detail: {
            reason: err instanceof Error ? err.message : String(err ?? ""),
          },
        }),
      }).catch(() => {});
    } catch {
      /* 記録はおまけ。ここで止めない。 */
    }
  }

  function reportSetupFailure(message: string, err: unknown) {
    reportIncident("payment", "card_form", message, err);
  }

  /*
    カード欄は**2段構え**で用意します。

    1. どちらで払えるのかを聞く（/api/payments/config）
    2. カード欄の置き場所が画面に出てから、Square を立ち上げて差し込む

    1本の useEffect でまとめてやっていたのが、本番で2件目の注文だけ
    「決済フォームの読み込みに失敗しました」になった原因でした。

    この画面は、買い物かごを localStorage から読むまで「読み込み中...」だけを
    描きます。その間 #square-card はまだ DOM にありません。1本にまとめた
    useEffect は画面が立ち上がった直後に走り、設定の取得と SDK の読み込みを
    待ってから attach します。**初回はその待ち時間のあいだに本体が描かれて
    いたので間に合っていました。** ところが同じタブでの2件目は、SDK が
    読み込み済みで設定も温まっているため待ち時間がほとんど無く、まだ存在
    しない #square-card に attach しようとして落ちていました。
    再読み込みで直るのは、また「遅い初回」に戻るからです。

    なので、置き場所が実際に DOM に入ったことを見てから立ち上げます。
  */
  const [cardHost, setCardHost] = useState<HTMLDivElement | null>(null);
  const [squareConfig, setSquareConfig] = useState<{
    applicationId: string;
    locationId: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const config = await fetchJson<{
          enabled: boolean;
          applicationId: string | null;
          locationId: string | null;
        }>("/api/payments/config");

        if (cancelled) return;
        setPayByCard(config.enabled);

        if (config.enabled && config.applicationId && config.locationId) {
          setSquareConfig({
            applicationId: config.applicationId,
            locationId: config.locationId,
          });
        }
      } catch (err) {
        console.error("Payment config error:", err);
        if (!cancelled) {
          setCardError(
            "決済の準備ができませんでした。ページを再読み込みしてください。"
          );
          reportSetupFailure("決済の設定を取得できませんでした", err);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /*
    この端末が前に覚えたカードを引く。

    鍵は Cookie で、こちらからは渡しません（ブラウザが勝手に付けます）。
    引けなければ、これまでどおりカード番号の入力欄が出るだけです。だから
    失敗しても黙って進みます。

    お名前・メール・電話も一緒に戻して、前と同じことを打ち直さなくて
    済むようにします。打ちかけの入力は上書きしません。
  */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/saved-card");
        if (!res.ok) return;
        const data = (await res.json()) as { card: SavedCard | null };
        if (cancelled || !data.card) return;

        setSavedCard(data.card);
        setUseSavedCard(true);
        setName((current) => current || data.card!.customer_name);
        setEmail((current) => current || data.card!.customer_email);
        setPhone((current) => current || data.card!.customer_phone);
      } catch {
        /* 覚えが無いのと同じに扱う。入力欄が出るだけ。 */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // 置き場所が無いうちは何もしない。ここが今回の肝。
    if (!squareConfig || !cardHost) return;

    let cancelled = false;
    let attachedCard: { destroy?: () => Promise<unknown> } | null = null;

    async function setUpPayment() {
      try {
        const { payments } = await import("@square/web-sdk");
        const sq = await payments(
          squareConfig!.applicationId,
          squareConfig!.locationId
        );
        if (cancelled || !sq) {
          if (!cancelled) {
            setCardError("決済フォームを読み込めませんでした");
            reportSetupFailure("Square を初期化できませんでした", null);
          }
          return;
        }

        paymentsRef.current = sq as unknown as SquarePayments;
        setPaymentsReady(true);

        /*
          カード欄の中を日本語にする。

          欄そのものは Square の iframe の中なので、こちらから文言を差し込む
          ことはできません（card() に placeholders のような引数はありません）。
          できるのは言語を指定することだけで、これで「カード番号」「MM/YY」
          やエラー文が日本語になります。

          端末の言語が日本語なら既定でも日本語になりますが、英語設定の端末で
          開かれると英語のままになります。ここは日本語の店なので、明示します。
          対応していない言語を渡したときは何も起きない仕様なので、失敗しても
          先へ進めます。
        */
        await sq.setLocale("ja-JP").catch(() => {});

        const card = await sq.card();
        await card.attach("#square-card");
        attachedCard = card;
        if (cancelled) {
          card.destroy();
          attachedCard = null;
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
          reportSetupFailure("決済フォームの読み込みに失敗しました", err);
        }
      }
    }

    setUpPayment();
    return () => {
      cancelled = true;
      // 財布（Apple Pay / Google Pay）と同じように、カード欄も必ず片付ける。
      attachedCard?.destroy?.().catch(() => {});
      attachedCard = null;
      cardRef.current = null;
      paymentsRef.current = null;
      setCardReady(false);
      setPaymentsReady(false);
    };
  }, [squareConfig, cardHost]);

  /**
   * Leaving mid-payment would take the money without ever showing the
   * customer their reservation — the request carries on at the server
   * whether or not the page is still there.
   */
  useEffect(() => {
    if (!placing) return;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [placing]);

  
  const totalAmount = cart.reduce(
    (sum, item) => sum + item.product.price * item.quantity,
    0
  );

  /**
   * Whether there is enough on hand to take an order.
   *
   * Everything below it reads the event — the pickup times most of all — so
   * a tap that arrives before it has loaded used to fall through every
   * guard and leave the screen sitting there. Saying so is the least we can
   * do; it is a second at worst.
   */
  function ready(): boolean {
    if (event && selectedDate) return true;
    setCardError(
      loadFailed
        ? "ご予約の情報を読み込めませんでした。ページを再読み込みしてください。"
        : "読み込み中です。少し待ってからもう一度お試しください。"
    );
    return false;
  }

  /**
   * 入力に不足があったとき、お客様をそこへ連れていく。
   *
   * 「注文を確定する」は画面のいちばん下にあり、足りない項目はずっと上に
   * あります。押しても画面が動かないので、**何も起きなかったように見えます**。
   * 最初の不足まで送って、そこに入力位置を移します。あわせてボタンのすぐ上に
   * 要約を出すので、押した場所でも反応が返ります（`formError`）。
   */
  function focusFirstError(errs: Record<string, string>) {
    const order = ["dining_style", "name", "email", "phone"];
    const first = order.find((key) => errs[key]);
    if (!first) return;

    const target = document.getElementById(`field-${first}`);
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "center" });
    // 入力欄なら、そのまま打てる状態にする。選ぶ欄なら押せる状態にする。
    const focusable = target.matches("input, select, textarea, button")
      ? target
      : target.querySelector<HTMLElement>("input, select, textarea, button");
    // スクロールと競合しないよう、動き終わってから移す。
    window.setTimeout(() => focusable?.focus({ preventScroll: true }), 350);
  }

  /** 足りないものを数えるだけ。画面には触らない。 */
  function findErrors(): Record<string, string> {
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
    if (!diningStyle) {
      errs.dining_style = "店内でお召し上がりか、お持ち帰りかを選んでください";
    }
    return errs;
  }

  function validate(): boolean {
    const errs = findErrors();
    setErrors(errs);
    setAttempted(true);

    const ok = Object.keys(errs).length === 0;
    setFormError(ok ? "" : "未入力の項目があります。");
    if (!ok) focusFirstError(errs);
    return ok;
  }

  /*
    一度押したあとは、入力に合わせて赤い文字を引っ込めます。

    押した時点の数をそのまま出しておくと、直したあとも「◯つ足りません」が
    残り、入れたはずなのにまだ足りないのかと迷わせます。数を出すのをやめて、
    直せば消える形にしました。押す前は何も出しません（まだ何も間違えていない
    のに赤くするのは失礼なので）。
  */
  useEffect(() => {
    if (!attempted) return;
    const errs = findErrors();
    setErrors(errs);
    setFormError(Object.keys(errs).length === 0 ? "" : "未入力の項目があります。");
    // findErrors は今の入力だけを見る純粋な関数。依存は入力そのもので足りる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempted, name, email, phone, diningStyle]);

  /**
   * Sends the reservation. The payment token is already in hand by this
   * point — whether it came from the card form or from a wallet — so all
   * that is left is to hand it to the server.
   */
  /**
   * 決済にたどり着けなかったことを、お店に知らせる。
   *
   * ここで拾う失敗は**サーバーに何も届きません**。注文も、取り消された注文も
   * 残らないので、あとから「何が起きたのか」を調べる手段がありませんでした
   * （2026-10-30 のお申し出がこれです）。
   *
   * お客様には何も見せません。送れなくても黙って続けます。
   */
  function report(
    stage: "card_form" | "tokenize" | "verify" | "submit" | "store_card",
    outcome: "declined" | "error" | "abandoned",
    message: string,
    detail?: unknown
  ) {
    try {
      void fetch("/api/incident", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          area: "payment",
          path: "/reserve/confirm",
          stage,
          outcome,
          message,
          detail,
          amount: totalAmount,
          customer_email: email.trim() || null,
        }),
      }).catch(() => {});
    } catch {
      /* 記録はおまけ。ここで止めない。 */
    }
  }

  async function placeOrder(
    paymentSourceId?: string,
    verificationToken?: string,
    payWithSavedCard = false
  ) {
    if (!event || !selectedDate) return;

    setPlacing(true);
    try {
      const res = await postOrder({
        client_request_id: requestIdRef.current,
        event_id: event.id,
        event_date_id: selectedDate.id,
        customer_name: name.trim(),
        customer_email: email.trim(),
        customer_phone: phone.trim(),
        dining_style: diningStyle,
        payment_method: payByCard ? "credit_card" : "cash",
        payment_source_id: paymentSourceId,
        verification_token: verificationToken,
        // 旗だけ。どのカードかはサーバーが Cookie から引き直す。
        use_saved_card: payWithSavedCard,
        /*
          覚えるのもサーバーに任せます。

          以前はここで決済のあともう一度 `tokenize()` を呼び、その結果を
          送っていました。本番で保存されず、2回目にカードが出てきません
          でした。Square は決済 id からもカードを保存できるので、画面には
          もう触らず、サーバーが決済 id を使って覚えます。
        */
        remember_card: payByCard && !payWithSavedCard && rememberCard,
        items: cart.map((item) => ({
          product_id: item.product.id,
          product_name_snapshot: item.product.name,
          unit_price: item.product.price,
          quantity: item.quantity,
        })),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const details = Array.isArray(data.details) ? data.details : [];
        alert(
          [data.error || "注文に失敗しました。もう一度お試しください。", ...details].join(
            "\n"
          )
        );
        setPlacing(false);
        setSubmitting(false);
        return;
      }

      const order = await res.json();
      localStorage.setItem("lastOrder", JSON.stringify(order));
      localStorage.removeItem("cart");
      // The overlay stays up through the transition, so the paid customer is
      // never looking at a live form they could submit a second time.
      router.push("/reserve/complete");
    } catch (err) {
      setPlacing(false);
      report("submit", "error", "注文の送信中に通信が途切れました", {
        reason: err instanceof Error ? err.message : String(err),
      });
      alert(
        "通信が途切れました。もう一度「注文を確定する」を押してください。\n" +
          "同じご注文が二重になることはありません。"
      );
      setSubmitting(false);
    }
  }

  /**
   * この端末の記憶を消す。
   *
   * Square 側のカードも止めます。消したあとは入力欄に戻るだけなので、
   * 失敗しても一言出して、そのまま使えるようにしておきます。
   */
  async function forgetCard() {
    setForgettingCard(true);
    try {
      const res = await fetch("/api/saved-card", { method: "DELETE" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setSavedCard(null);
      setUseSavedCard(false);
      setCardError("");
    } catch (err) {
      setCardError(
        "カードの削除に失敗しました。「別のカードを使う」から入力していただくこともできます。"
      );
      report("store_card", "error", "保存カードの削除に失敗しました", {
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setForgettingCard(false);
    }
  }

  /** The card form: tokenise, verify the buyer, then order. */
  async function handleSubmit() {
    if (!ready()) return;
    if (!validate() || !event || !selectedDate) return;

    setSubmitting(true);
    setCardError("");

    const usingSavedCard = Boolean(payByCard && savedCard && useSavedCard);

    let paymentSourceId: string | undefined;
    let verificationToken: string | undefined;

    /*
      覚えてあるカードで払う。

      入力欄は出ていないのでトークンは作りません。本人認証だけ先に通して、
      どのカードかはサーバーに Cookie から引いてもらいます。
    */
    if (payByCard && usingSavedCard) {
      let token: string | undefined;
      try {
        const verification = await paymentsRef.current?.verifyBuyer(
          savedCard!.square_card_id,
          {
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
        token = verification?.token;
      } catch (err) {
        console.error("verifyBuyer (saved card) error:", err);
        setCardError(
          "カード会社の本人認証が完了しませんでした。「別のカードを使う」から入力し直すこともできます。"
        );
        report("verify", "error", "保存カードの本人認証が完了しませんでした", {
          reason: err instanceof Error ? err.message : String(err),
        });
        setSubmitting(false);
        return;
      }

      await placeOrder(undefined, token, true);
      return;
    }

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
          const reason =
            result.errors?.[0]?.message ??
            "カード情報をご確認のうえ、もう一度お試しください。";
          setCardError(reason);
          report("tokenize", "declined", reason, { status: result.status });
          setSubmitting(false);
          return;
        }
        paymentSourceId = result.token;
      } catch (err) {
        console.error("Tokenize error:", err);
        setCardError("カード情報の確認に失敗しました。もう一度お試しください。");
        report("tokenize", "error", "カード情報の確認に失敗しました", {
          reason: err instanceof Error ? err.message : String(err),
        });
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
        report("verify", "error", "カード会社の本人認証が完了しませんでした", {
          reason: err instanceof Error ? err.message : String(err),
        });
        setSubmitting(false);
        return;
      }
    }

    await placeOrder(paymentSourceId, verificationToken);
  }

  if (!selectedDate || cart.length === 0) {
    return (
      <main className="min-h-screen bg-paper flex items-center justify-center">
        <div className="animate-pulse text-zinc-400">読み込み中...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-paper pb-8">
      {/*
        While the money is moving, nothing else on the page can be touched.
        The request takes a few seconds, and a stray tap on the back arrow or
        a product would leave the customer charged with no reservation in
        front of them — or paying twice by starting over.
      */}
      {placing && (
        <div
          role="alertdialog"
          aria-busy="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/60 px-6 backdrop-blur-sm"
        >
          <div className="w-full max-w-xs rounded-2xl bg-white px-6 py-7 text-center shadow-xl">
            <svg
              className="mx-auto mb-4 h-8 w-8 animate-spin text-brand-600"
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
            <p className="font-bold text-zinc-800">お支払いを処理しています</p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">
              数秒かかります。
              <br />
              この画面を閉じずにお待ちください。
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            disabled={submitting}
            className="text-zinc-400 transition-colors hover:text-zinc-600 disabled:opacity-40"
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
          <h1 className="text-lg font-bold text-zinc-800">
            ご注文の確認
          </h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
        {/* Pickup Date */}
        <div className="bg-brand-50 border border-brand-200 rounded-2xl p-5 text-center">
          <p className="text-xs text-brand-500 font-medium mb-1">受取日</p>
          <p className="text-2xl font-bold text-brand-800">
            {formatDate(selectedDate.pickup_date)}
          </p>
        </div>

        {/* 店内かお持ち帰りか。既定を置かず、必ず選んでいただく。 */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-4">
          <h2 className="font-bold text-zinc-700 text-sm mb-1">
            お召し上がり方法 <span className="text-red-400">*</span>
          </h2>
          <p className="text-xs text-zinc-400 mb-3">
            どちらをお選びでも、お支払い金額は変わりません。
          </p>
          <div id="field-dining_style" className="grid grid-cols-2 gap-2">
            {(
              [
                { value: "eat_in", label: "店内で食べる", note: "イートイン" },
                { value: "takeout", label: "持ち帰る", note: "テイクアウト" },
              ] as const
            ).map((option) => {
              const selected = diningStyle === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDiningStyle(option.value)}
                  aria-pressed={selected}
                  className={`rounded-xl border-2 px-3 py-3 text-sm font-medium transition-colors ${
                    selected
                      ? "border-brand-500 bg-brand-50 text-brand-800"
                      : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                  }`}
                >
                  {option.label}
                  <span className="mt-0.5 block text-xs font-normal text-zinc-400">
                    {option.note}
                  </span>
                </button>
              );
            })}
          </div>
          {errors.dining_style && (
            <p role="alert" className="text-red-500 text-xs mt-2">{errors.dining_style}</p>
          )}
        </div>

        {/* Product List */}
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100">
            <h2 className="font-bold text-zinc-700 text-sm">
              ご注文内容
            </h2>
          </div>
          <div className="divide-y divide-zinc-100">
            {cart.map((item) => (
              <div key={item.product.id} className="flex items-center gap-3 p-4">
                <div className="w-14 h-14 rounded-lg bg-zinc-100 overflow-hidden shrink-0 relative">
                  {item.product.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.product.image_url}
                      alt={item.product.name}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-300">
                      <Icon name="coffee" className="w-6 h-6" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-800 truncate">
                    {item.product.name}
                  </p>
                  <p className="text-xs text-zinc-400">
                    {formatPrice(item.product.price)} x {item.quantity}
                  </p>
                </div>
                <p className="font-bold text-zinc-800 text-sm shrink-0">
                  {formatPrice(item.product.price * item.quantity)}
                </p>
              </div>
            ))}
          </div>
          <div className="border-t border-zinc-200 px-4 py-4 flex items-center justify-between bg-paper/50">
            <span className="font-bold text-zinc-600">合計</span>
            <span className="text-xl font-bold text-brand-700">
              {formatPrice(totalAmount)}
            </span>
          </div>
          {/*
            「やっぱりこれも」で戻れるように。

            上の隅にも戻る矢印はありますが、この画面は長く、ご注文内容を見て
            気が変わるのはたいていこの位置です。そこまで戻ってもらうより、
            見ているところに置くほうが素直です。

            戻ると商品の画面は選んでいた内容を取り戻します（`restoreCart`）。
            以前はカゴが空になっていたので、戻る道は実質ありませんでした。
          */}
          <div className="border-t border-zinc-100 p-3">
            <button
              type="button"
              onClick={() => router.push(`/reserve/${selectedDate.id}`)}
              disabled={placing}
              className="w-full rounded-xl border border-zinc-200 bg-white py-3 text-sm font-semibold text-zinc-700 transition-colors hover:bg-paper disabled:opacity-50"
            >
              商品を追加・変更する
            </button>
          </div>
        </div>

        {/* Pickup Info */}
        {event && (
          <div className="bg-white rounded-2xl border border-zinc-200 p-4">
            <h2 className="font-bold text-zinc-700 text-sm mb-3">
              受取情報
            </h2>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Icon name="pin" className="w-4 h-4 text-brand-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs text-zinc-400">受取場所</p>
                  <p className="text-zinc-800 text-sm font-medium">
                    {event.pickup_location}
                  </p>
                </div>
              </div>
              {event.reservation_note && (
                <div className="flex items-start gap-2">
                  <Icon name="note" className="w-4 h-4 text-brand-500 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-zinc-400">備考</p>
                    <p className="text-zinc-600 text-sm whitespace-pre-line">
                      {event.reservation_note}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Customer Info Form */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-4">
          <h2 className="font-bold text-zinc-700 text-sm mb-4">
            お客様情報
          </h2>
          <div className="space-y-4">
            <div id="field-name">
              <label className="block text-xs text-zinc-500 mb-1.5 font-medium">
                お名前 <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="山田 太郎"
                className={`w-full px-4 py-3 rounded-xl border text-sm bg-paper transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent ${
                  errors.name ? "border-red-300" : "border-zinc-200"
                }`}
              />
              {errors.name && (
                <p role="alert" className="text-red-500 text-xs mt-1">{errors.name}</p>
              )}
            </div>
            <div id="field-email">
              <label className="block text-xs text-zinc-500 mb-1.5 font-medium">
                メールアドレス <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="taro@example.com"
                className={`w-full px-4 py-3 rounded-xl border text-sm bg-paper transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent ${
                  errors.email ? "border-red-300" : "border-zinc-200"
                }`}
              />
              {errors.email && (
                <p role="alert" className="text-red-500 text-xs mt-1">{errors.email}</p>
              )}
            </div>
            <div id="field-phone">
              <label className="block text-xs text-zinc-500 mb-1.5 font-medium">
                電話番号 <span className="text-red-400">*</span>
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="090-1234-5678"
                className={`w-full px-4 py-3 rounded-xl border text-sm bg-paper transition-colors focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent ${
                  errors.phone ? "border-red-300" : "border-zinc-200"
                }`}
              />
              {errors.phone && (
                <p role="alert" className="text-red-500 text-xs mt-1">{errors.phone}</p>
              )}
            </div>
          </div>
        </div>

        {/* Payment Method */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-4">
          <h2 className="font-bold text-zinc-700 text-sm mb-4">
            お支払い方法
          </h2>
          {payByCard === null && (
            <p className="text-sm text-zinc-400">読み込み中...</p>
          )}

          {payByCard === false && (
            <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-brand-500 bg-brand-50">
              <div className="w-5 h-5 rounded-full border-2 border-brand-500 flex items-center justify-center">
                <div className="w-2.5 h-2.5 rounded-full bg-brand-500" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-zinc-800">現地払い</p>
                <p className="text-xs text-zinc-500">受取時にお支払い</p>
              </div>
              <Icon name="cash" className="w-5 h-5 text-brand-600" />
            </div>
          )}

          {payByCard === true && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-xl border-2 border-brand-500 bg-brand-50">
                <div className="w-5 h-5 rounded-full border-2 border-brand-500 flex items-center justify-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-brand-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-zinc-800">
                    クレジットカード
                  </p>
                  <p className="text-xs text-zinc-500">
                    ご予約の確定時にお支払いが完了します
                  </p>
                </div>
                <Icon name="card" className="w-5 h-5 text-brand-600" />
              </div>

              {/*
                前に使ったカードがあるときは、それを出して入力欄は出しません。

                出すのは下4桁とブランドだけです。これが出るのは、この端末に
                置いた無記名の鍵を持っているあいだだけで、メールアドレスを
                打っても他の方のカードが出ることはありません。
              */}
              {savedCard && useSavedCard ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3">
                    <Icon name="card" className="h-5 w-5 shrink-0 text-zinc-400" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-zinc-800">
                        {savedCard.brand
                          ? `${cardBrandLabel(savedCard.brand)} •••• ${savedCard.last4}`
                          : `カード •••• ${savedCard.last4}`}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {savedCard.exp_month && savedCard.exp_year
                          ? `有効期限 ${String(savedCard.exp_month).padStart(2, "0")}/${String(
                              savedCard.exp_year
                            ).slice(-2)} ・ `
                          : ""}
                        この端末に保存されています
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setUseSavedCard(false)}
                      className="font-medium text-brand-700 underline underline-offset-2"
                    >
                      別のカードを使う
                    </button>
                    <button
                      type="button"
                      disabled={forgettingCard}
                      onClick={forgetCard}
                      className="text-zinc-500 underline underline-offset-2 disabled:opacity-50"
                    >
                      {forgettingCard ? "削除中..." : "このカードを削除する"}
                    </button>
                  </div>

                  {cardError && (
                    <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                      {cardError}
                    </p>
                  )}

                  <p className="text-xs leading-relaxed text-zinc-400">
                    カード番号は決済代行会社（Square）が預かっており、当店のサーバーにはありません。
                    <br />
                    ご注文の確定時に、カード会社の本人認証（3Dセキュア）画面が表示される場合があります。
                  </p>
                </div>
              ) : (
                <>
                  {/*
                    ここが DOM に入ったことを見てから Square を立ち上げます。
                    置き場所の無いうちに差し込もうとすると落ちます。
                  */}
                  <div
                    id="square-card"
                    ref={setCardHost}
                    className="rounded-xl border border-zinc-200 bg-white p-3 min-h-[92px]"
                  />

                  {!cardReady && !cardError && (
                    <p className="text-xs text-zinc-400">
                      決済フォームを読み込んでいます...
                    </p>
                  )}

                  {cardError && (
                    <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                      {cardError}
                    </p>
                  )}

                  {savedCard && (
                    <button
                      type="button"
                      onClick={() => {
                        setUseSavedCard(true);
                        setCardError("");
                      }}
                      className="text-xs font-medium text-brand-700 underline underline-offset-2"
                    >
                      保存されたカード（•••• {savedCard.last4}）に戻す
                    </button>
                  )}

                  {/*
                    次回のために覚えるかどうか。

                    イートインとテイクアウト、受取日が違えば別のお会計になるので、
                    何度か払う方がいらっしゃいます。初期値は「覚える」にしてあり、
                    外せばこれまでどおり毎回の入力です。
                  */}
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-zinc-200 bg-white p-3">
                    <input
                      type="checkbox"
                      checked={rememberCard}
                      onChange={(e) => setRememberCard(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                    />
                    <span className="text-xs leading-relaxed text-zinc-600">
                      <span className="font-semibold text-zinc-800">
                        次回のために、このカードをこの端末に記憶する
                      </span>
                      <br />
                      次からは下4桁を選ぶだけでお支払いいただけます。カード番号は
                      決済代行会社（Square）が預かり、当店のサーバーには残りません。
                      この画面からいつでも削除できます。
                    </span>
                  </label>

                  <p className="text-xs leading-relaxed text-zinc-400">
                    カード情報は決済代行会社（Square）が直接受け取ります。当店のサーバーには保存されません。
                    <br />
                    ご注文の確定時に、カード会社の本人認証（3Dセキュア）画面が表示される場合があります。
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {/*
          押した場所で反応を返す。

          足りない項目は画面のずっと上にあるので、ボタンの周りで何も変わらないと
          「押しても無反応」に見えます。ここに1行出したうえで、`validate()` が
          最初の不足まで画面を送ります。読み上げソフトにも伝わるよう role="alert"。
        */}
        {formError && (
          <p
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
          >
            {formError}
          </p>
        )}

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          /*
            `event` has to be here too. Without it the button could go live
            on the strength of the payment settings alone, while the event —
            which is where the pickup times come from — was still loading;
            tapping then fell straight out of handleSubmit and the screen
            did nothing at all, with nothing to say why.
          */
          disabled={
            submitting ||
            !event ||
            payByCard === null ||
            // 保存カードで払うときは、入力欄が無いので待つものもない。
            (payByCard === true &&
              !(savedCard && useSavedCard) &&
              !cardReady)
          }
          className={`w-full py-4 rounded-2xl font-bold text-lg transition-colors ${
            submitting || !event
              ? "bg-zinc-300 text-zinc-500 cursor-not-allowed"
              : "bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white shadow-lg shadow-brand-600/20"
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

        <p className="text-center text-xs text-zinc-400">
          注文確定後、確認メールが送信されます
        </p>

        <SiteFooter />
      </div>
    </main>
  );
}
