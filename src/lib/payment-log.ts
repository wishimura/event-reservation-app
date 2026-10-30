import { db } from "@/db";
import { paymentLogs } from "@/db/schema";

/**
 * 決済まわりで起きたことを書き留める。
 *
 * ## 守ること
 *
 * **この関数は決して投げません。** 記録に失敗したせいで決済が止まるのは本末
 * 転倒です。書けなければコンソールに残して、そのまま進みます。
 *
 * **カード情報は受け取りません。** 番号も、Square のトークンも、ここを通しては
 * いけません。入れてよいのは「どの段階で」「どう転んだか」と、突き合わせに
 * 要る最小限だけです。
 */

export type PaymentLogStage =
  | "card_form"
  | "tokenize"
  | "verify"
  | "submit"
  | "charge"
  | "record";

export type PaymentLogOutcome = "ok" | "declined" | "error" | "abandoned";

export const PAYMENT_LOG_STAGES: PaymentLogStage[] = [
  "card_form",
  "tokenize",
  "verify",
  "submit",
  "charge",
  "record",
];

export const PAYMENT_LOG_OUTCOMES: PaymentLogOutcome[] = [
  "ok",
  "declined",
  "error",
  "abandoned",
];

/** 長すぎるものは切る。相手は人の端末なので、素直に信じない。 */
const MAX_MESSAGE = 500;
const MAX_EMAIL = 200;
const MAX_ORDER_NUMBER = 40;
const MAX_USER_AGENT = 300;
const MAX_DETAIL_BYTES = 2000;

export interface PaymentLogEntry {
  source: "server" | "browser";
  stage: PaymentLogStage;
  outcome: PaymentLogOutcome;
  order_number?: string | null;
  amount?: number | null;
  customer_email?: string | null;
  message?: string | null;
  detail?: unknown;
  user_agent?: string | null;
}

function clip(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * 詳細は JSON にして長さで切る。
 *
 * 入れ子の中身までは見ないので、**呼ぶ側がカード情報を渡さないこと**が前提です。
 */
function clipDetail(detail: unknown): unknown {
  if (detail === undefined || detail === null) return null;
  try {
    const json = JSON.stringify(detail);
    if (json === undefined) return null;
    if (json.length <= MAX_DETAIL_BYTES) return detail;
    return { truncated: json.slice(0, MAX_DETAIL_BYTES) };
  } catch {
    return null;
  }
}

export async function recordPaymentEvent(entry: PaymentLogEntry): Promise<void> {
  try {
    await db.insert(paymentLogs).values({
      source: entry.source,
      stage: entry.stage,
      outcome: entry.outcome,
      order_number: clip(entry.order_number, MAX_ORDER_NUMBER),
      amount:
        typeof entry.amount === "number" && Number.isFinite(entry.amount)
          ? Math.trunc(entry.amount)
          : null,
      customer_email: clip(entry.customer_email, MAX_EMAIL),
      message: clip(entry.message, MAX_MESSAGE) ?? "",
      detail: clipDetail(entry.detail),
      user_agent: clip(entry.user_agent, MAX_USER_AGENT),
    });
  } catch (error) {
    // 記録できなくても決済は続ける。残せるところには残す。
    console.error("Failed to record a payment event:", entry.stage, entry.outcome, error);
  }
}
