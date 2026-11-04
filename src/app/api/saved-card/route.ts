import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { savedCards } from "@/db/schema";
import { recordIncident } from "@/lib/incident-log";
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE,
  findSavedCard,
  forgetSavedCard,
  hashDeviceToken,
  newDeviceToken,
  toSavedCardView,
} from "@/lib/saved-card";
import { disableStoredCard, isSquareEnabled, storeCardForNextTime } from "@/lib/square";

/**
 * この端末が覚えているカード。
 *
 * ## 読む・覚える・忘れる
 *
 * どれも **Cookie の持ち主だけ** が自分の1枚に触れます。本文でカードを
 * 名指しすることはできません。「このカードで」と書かれていても見ずに、
 * Cookie から引き直します。そうでないと、id を当てた人が他人のカードで
 * 決済できてしまいます。
 */

export const dynamic = "force-dynamic";

function deviceToken(request: NextRequest): string | undefined {
  return request.cookies.get(DEVICE_COOKIE)?.value;
}

/** この端末の1枚を返す。無ければ null。 */
export async function GET(request: NextRequest) {
  const row = await findSavedCard(deviceToken(request));
  return NextResponse.json({ card: row ? toSavedCardView(row) : null });
}

interface StoreBody {
  /** `card.tokenize()` の新しいトークン。決済に使ったものとは別。 */
  source_id?: unknown;
  /** `verifyBuyer(token, { intent: "STORE" })` の結果。無くてもよい。 */
  verification_token?: unknown;
  customer_name?: unknown;
  customer_email?: unknown;
  customer_phone?: unknown;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * 次回のために覚える。
 *
 * ご注文が通った**あと**に呼ばれます。ここで転んでも、支払いも予約も
 * もう済んでいて、次回また入力してもらうだけで済みます。だから失敗しても
 * 200 を返し、記録だけ残します。
 */
export async function POST(request: NextRequest) {
  if (!isSquareEnabled()) {
    return NextResponse.json({ saved: false });
  }

  let body: StoreBody;
  try {
    body = (await request.json()) as StoreBody;
  } catch {
    return NextResponse.json({ saved: false });
  }

  const sourceId = text(body.source_id, 200);
  if (!sourceId) return NextResponse.json({ saved: false });

  /*
    端末の鍵。まだ無ければここで配ります。

    有効な Cookie を持って来た端末はそれを使い続けます。付け替えると、
    同じ端末なのに前の行が宙に浮いて、誰にも消せない Square のカードが
    残ります。
  */
  const existingToken = deviceToken(request);
  const token = existingToken || newDeviceToken();

  const previous = await findSavedCard(token);

  let stored;
  try {
    stored = await storeCardForNextTime({
      sourceId,
      idempotencyKey: `${hashDeviceToken(token).slice(0, 16)}-${Date.now()}`,
      customerName: text(body.customer_name, 100),
      customerEmail: text(body.customer_email, 200),
      customerPhone: text(body.customer_phone, 40),
      verificationToken: text(body.verification_token, 500) || undefined,
    });
  } catch (error) {
    /*
      よくあるのは、お客様の銀行がカードを預けるのに本人認証を求めていて、
      その結果（verification_token）が付いていない場合です。お客様には
      何も起きません——支払いは既に済んでいます。
    */
    await recordIncident({
      area: "payment",
      source: "server",
      stage: "store_card",
      outcome: "error",
      customer_email: text(body.customer_email, 200),
      message: "次回のためのカード保存に失敗しました",
      detail: { reason: error instanceof Error ? error.message : String(error) },
      path: "/api/saved-card",
    });
    return NextResponse.json({ saved: false });
  }

  try {
    // 1端末に1枚。入れ替えるときは、前のカードを Square 側でも止める。
    if (previous) {
      await db.delete(savedCards).where(eq(savedCards.id, previous.id));
      await disableStoredCard(previous.square_card_id);
    }

    await db.insert(savedCards).values({
      device_token_hash: hashDeviceToken(token),
      square_customer_id: stored.customerId,
      square_card_id: stored.cardId,
      card_brand: stored.brand,
      last4: stored.last4,
      exp_month: stored.expMonth,
      exp_year: stored.expYear,
      customer_name: text(body.customer_name, 100),
      customer_email: text(body.customer_email, 200),
      customer_phone: text(body.customer_phone, 40),
    });
  } catch (error) {
    await recordIncident({
      area: "payment",
      source: "server",
      stage: "store_card",
      outcome: "error",
      message: "保存したカードを書き留められませんでした",
      detail: { reason: error instanceof Error ? error.message : String(error) },
      path: "/api/saved-card",
    });
    // Square には残ってしまうので、こちらで持たないカードは止めておく。
    await disableStoredCard(stored.cardId);
    return NextResponse.json({ saved: false });
  }

  const response = NextResponse.json({ saved: true });
  if (!existingToken) setDeviceCookie(response, token);
  return response;
}

/** 「このカードを忘れる」。Square 側でも止める。 */
export async function DELETE(request: NextRequest) {
  const token = deviceToken(request);
  if (!token) return NextResponse.json({ ok: true });

  const row = await findSavedCard(token);
  if (!row) return NextResponse.json({ ok: true });

  try {
    await forgetSavedCard(token);
  } catch (error) {
    console.error("Failed to forget a saved card:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  await disableStoredCard(row.square_card_id);
  return NextResponse.json({ ok: true });
}

function setDeviceCookie(response: NextResponse, token: string) {
  response.cookies.set(DEVICE_COOKIE, token, {
    httpOnly: true,
    // 画面の JavaScript からは読めません。読む必要がないので読ませない。
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE,
  });
}
