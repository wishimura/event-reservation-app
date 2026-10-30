import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http";
import {
  PAYMENT_LOG_OUTCOMES,
  PAYMENT_LOG_STAGES,
  recordPaymentEvent,
  type PaymentLogOutcome,
  type PaymentLogStage,
} from "@/lib/payment-log";

export const dynamic = "force-dynamic";

/**
 * ブラウザで起きた、決済にたどり着けなかった出来事を受け取る。
 *
 * ## なぜ公開しているか
 *
 * ここで拾いたいのは **サーバーまで届かなかった失敗**です。カード入力欄が
 * 出なかった、トークン化で転んだ、本人認証が返ってこなかった。どれもログイン
 * 前のお客様の端末で起きるので、認証の内側には置けません。
 *
 * 2026-10-30 のお申し出がまさにこれでした。注文も、取り消された注文も残って
 * おらず、何が起きたのか確かめる手段がありませんでした。
 *
 * ## 誰でも書けることへの備え
 *
 * 受け取るのは決まった形だけで、知らない値は断ります。文字列は長さで切ります
 * （`recordPaymentEvent`）。それでも、いたずらで行が増やせること自体は
 * 変えられません。**運用の記録であって、監査証跡ではありません。**
 * お金の証拠は Square の明細と注文の行であって、この表ではありません。
 */
export async function POST(request: NextRequest) {
  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const stage = body.stage;
  const outcome = body.outcome;

  if (
    typeof stage !== "string" ||
    !PAYMENT_LOG_STAGES.includes(stage as PaymentLogStage)
  ) {
    return NextResponse.json({ error: "stage が不正です" }, { status: 400 });
  }
  if (
    typeof outcome !== "string" ||
    !PAYMENT_LOG_OUTCOMES.includes(outcome as PaymentLogOutcome)
  ) {
    return NextResponse.json({ error: "outcome が不正です" }, { status: 400 });
  }

  await recordPaymentEvent({
    source: "browser",
    stage: stage as PaymentLogStage,
    outcome: outcome as PaymentLogOutcome,
    order_number: typeof body.order_number === "string" ? body.order_number : null,
    amount: typeof body.amount === "number" ? body.amount : null,
    customer_email:
      typeof body.customer_email === "string" ? body.customer_email : null,
    message: typeof body.message === "string" ? body.message : null,
    detail: body.detail,
    user_agent: request.headers.get("user-agent"),
  });

  // 記録できたかどうかはお客様に関係がない。常に受け取ったことだけ返す。
  return NextResponse.json({ ok: true });
}
