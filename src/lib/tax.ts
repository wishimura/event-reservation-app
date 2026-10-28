/**
 * 消費税。
 *
 * 売値は店内でも持ち帰りでも同じです。お客様から見た金額は1円も変わりません。
 * 変わるのは税率のほうで、持ち帰りは軽減税率の8%、店内飲食は10%。つまり同じ
 * 840円でも、お店に残る額と納める税額が違います。
 *
 *   持ち帰り 840円 → 税抜 777円 / 消費税 63円
 *   店内飲食 840円 → 税抜 763円 / 消費税 77円
 *
 * 税額は保存せず、必要なときにここで計算します。保存してしまうと、端数の
 * 扱いを変えたくなったときに過去分だけ古い計算のまま残るためです。残すのは
 * 「どちらだったか」だけで十分です。
 */

import type { DiningStyle } from "./types";

/** 税込価格に含まれる税率。 */
export const TAX_RATES: Record<DiningStyle, number> = {
  takeout: 0.08,
  eat_in: 0.1,
};

export interface TaxBreakdown {
  /** 0.08 / 0.1 */
  rate: number;
  /** 8 / 10（表示用） */
  percent: number;
  /** お客様が払う額。提供区分によらず同じ。 */
  total: number;
  /** 税抜の売上。 */
  net: number;
  /** 預かった消費税。 */
  tax: number;
}

/**
 * 税込の合計から、税抜と消費税を割り出す。
 *
 * 丸めるのは注文ごとに1回だけです。商品1点ずつ丸めて足すと、合計が実際に
 * 決済した額と1〜2円ずれることがあり、Square の明細と突き合わせたときに
 * 合わなくなります。税抜を切り捨て、残りを消費税とすることで、
 * 税抜 + 消費税 が必ず決済額ちょうどになります。
 */
export function taxBreakdown(
  totalAmount: number,
  diningStyle: DiningStyle
): TaxBreakdown {
  const rate = TAX_RATES[diningStyle] ?? TAX_RATES.takeout;
  const total = Math.max(0, Math.round(totalAmount));
  const net = Math.floor(total / (1 + rate));

  return {
    rate,
    percent: Math.round(rate * 100),
    total,
    net,
    tax: total - net,
  };
}

/** 画面に出す呼び方。 */
export const DINING_STYLE_LABELS: Record<DiningStyle, string> = {
  eat_in: "イートイン",
  takeout: "テイクアウト",
};

export function diningStyleLabel(style: DiningStyle): string {
  return DINING_STYLE_LABELS[style] ?? DINING_STYLE_LABELS.takeout;
}

/**
 * 受取日の呼び方。
 *
 * 店内で召し上がる方に「受取日」は少しよそよそしいので、「来店日」と
 * 呼びます。まだ選ぶ前の一覧では、どちらの方も見るので「受取日」のままです。
 */
export function pickupDateLabel(style: DiningStyle | null | undefined): string {
  return handoverWording(style).dateLabel;
}

/**
 * 受け渡しまわりの言い回し。
 *
 * 中身はどちらも同じで、変わるのは呼び方だけです。店内で召し上がる方に
 * 「お受け取り」「受取日」と申し上げるのは少しよそよそしいので、ご予約が
 * 確定したあとの画面とメールでは言葉を分けます。
 *
 * 日付の一覧のように、まだどちらか決まっていない場面では使いません。
 */
export interface HandoverWording {
  /** 日付の見出し。 */
  dateLabel: string;
  /** 「受取について」にあたる見出し。 */
  sectionTitle: string;
  /** 注文番号の下に添える一言。 */
  numberHint: string;
  /** 場所の見出し。 */
  placeLabel: string;
  /** 現地払いのときの書き方。 */
  cashNote: string;
  /** 当日のお願い。 */
  reminder: string;
  /** 件名の末尾など、短く言い切るとき。 */
  shortAction: string;
}

export function handoverWording(
  style: DiningStyle | null | undefined
): HandoverWording {
  if (style === "eat_in") {
    return {
      dateLabel: "来店日",
      sectionTitle: "ご来店について",
      numberHint: "ご来店時にこの番号をお伝えください",
      placeLabel: "店舗",
      cashNote: "現地払い（ご来店時にお支払い）",
      reminder: "来店日当日に店頭で、注文番号をスタッフにお伝えください。",
      shortAction: "ご来店",
    };
  }
  return {
    dateLabel: "受取日",
    sectionTitle: "受取について",
    numberHint: "受取時にこの番号をお伝えください",
    placeLabel: "受取場所",
    cashNote: "現地払い（受取時にお支払い）",
    reminder: "受取日当日にご来店の上、注文番号をスタッフにお伝えください。",
    shortAction: "お受け取り",
  };
}
