import { db } from "@/db";
import { incidentLogs } from "@/db/schema";

/**
 * 調べるための記録を書き留める。
 *
 * ## 守ること
 *
 * **この関数は決して投げません。** 記録に失敗したせいで注文や決済が止まるのは
 * 本末転倒です。書けなければコンソールに残して、そのまま進みます。
 *
 * **カード情報は受け取りません。** 番号も、Square のトークンも、ここを通しては
 * いけません。入れてよいのは「どこで」「どう転んだか」と、突き合わせに
 * 要る最小限だけです。
 */

/** 何についての記録か。 */
export type IncidentArea = "payment" | "email" | "screen" | "data" | "server";

export const INCIDENT_AREAS: IncidentArea[] = [
  "payment",
  "email",
  "screen",
  "data",
  "server",
];

/**
 * どこで転んだか。
 *
 * 決済（payment）はお客様が進む順に並べてあります。ほかの種別は1語です。
 */
export const INCIDENT_STAGES = [
  // payment
  "card_form",
  "tokenize",
  "verify",
  "submit",
  "charge",
  "record",
  // email
  "customer_mail",
  "shop_mail",
  "mail_config",
  // screen / data / server
  "render",
  "uncaught",
  "load",
  "request",
] as const;

export type IncidentStage = (typeof INCIDENT_STAGES)[number];

export type IncidentOutcome = "ok" | "declined" | "error" | "abandoned";

export const INCIDENT_OUTCOMES: IncidentOutcome[] = [
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
const MAX_PATH = 200;
const MAX_DETAIL_BYTES = 2000;

export interface IncidentEntry {
  area: IncidentArea;
  source: "server" | "browser";
  stage: IncidentStage;
  outcome: IncidentOutcome;
  order_number?: string | null;
  amount?: number | null;
  customer_email?: string | null;
  message?: string | null;
  detail?: unknown;
  path?: string | null;
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

export async function recordIncident(entry: IncidentEntry): Promise<void> {
  try {
    await db.insert(incidentLogs).values({
      area: entry.area,
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
      path: clip(entry.path, MAX_PATH),
      user_agent: clip(entry.user_agent, MAX_USER_AGENT),
    });
  } catch (error) {
    // 記録できなくても本筋は続ける。残せるところには残す。
    console.error(
      "Failed to record an incident:",
      entry.area,
      entry.stage,
      entry.outcome,
      error
    );
  }
}

/** 決済まわりの記録。種別を書き忘れないための入口。 */
export function recordPaymentEvent(
  entry: Omit<IncidentEntry, "area">
): Promise<void> {
  return recordIncident({ ...entry, area: "payment" });
}
