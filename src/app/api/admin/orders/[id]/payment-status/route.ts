import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { isUuid, readJsonObject } from "@/lib/http";
import { recordPaymentEvent } from "@/lib/incident-log";

export const dynamic = "force-dynamic";

/**
 * お支払いを頂いたかどうかを、あとから直す。
 *
 * カウンターでは「先に商品だけ渡して、お会計はあとで」が起きます。登録の
 * ときに決めた通りにならないことがあるので、直せるようにしてあります。
 *
 * ## ここでお金は動きません
 *
 * 直すのは**こちらの帳簿の表示だけ**です。Square は何も知りません。
 * カード決済のネット予約をここで触ると、Square の記録と食い違います。
 * だから触れるのは店頭販売だけにしてあります。
 *
 * 誰がいつ変えたかは調査ログに残します。お金の状態を手で動かした記録が
 * どこにも無いのは、あとから数が合わなくなったときに困ります。
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "注文が見つかりません" }, { status: 404 });
    }

    const body = await readJsonObject(request);
    const next = (body as { payment_status?: unknown } | null)?.payment_status;

    if (next !== "paid" && next !== "pending") {
      return NextResponse.json(
        { error: "お支払い状況の指定が不正です" },
        { status: 400 }
      );
    }

    const [order] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);

    if (!order) {
      return NextResponse.json({ error: "注文が見つかりません" }, { status: 404 });
    }

    /*
      ネット予約には触らせません。

      あちらのお金は Square が持っていて、こちらが表示だけ書き換えると
      二度と突き合わせられなくなります。返金も入金も Square 側の操作です。
    */
    if (order.source !== "walk_in") {
      return NextResponse.json(
        {
          error:
            "ネット予約のお支払い状況は、この画面では変更できません（Square の記録と食い違うため）",
        },
        { status: 400 }
      );
    }

    if (order.order_status === "cancelled") {
      return NextResponse.json(
        { error: "キャンセル済みの注文は変更できません" },
        { status: 400 }
      );
    }

    if (order.payment_status === next) {
      return NextResponse.json({ ok: true, payment_status: next });
    }

    const [updated] = await db
      .update(orders)
      .set({
        payment_status: next,
        // 頂いていないお金に日時が付いているのは、ただの嘘。
        paid_at: next === "paid" ? new Date() : null,
      })
      .where(eq(orders.id, id))
      .returning();

    await recordPaymentEvent({
      source: "server",
      stage: "record",
      outcome: "ok",
      order_number: order.order_number,
      amount: order.total_amount,
      customer_email: order.customer_email || null,
      message:
        next === "paid"
          ? "店頭販売を「お支払い済み」に変更しました"
          : "店頭販売を「未払い」に戻しました",
      detail: { from: order.payment_status, to: next },
      user_agent: request.headers.get("user-agent"),
    });

    return NextResponse.json({ ok: true, payment_status: updated.payment_status });
  } catch (error) {
    console.error("Payment status update error:", error);
    return NextResponse.json(
      { error: "お支払い状況の変更に失敗しました" },
      { status: 500 }
    );
  }
}
