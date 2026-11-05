import { NextRequest, NextResponse } from "next/server";
import { cancelOrderAndReleaseStock, OrderCancelError } from "@/lib/orders";
import { isUuid } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Cancels an order and returns its stock to the day's allowance.
 *
 * 一方通行ではなくなりました。戻す口は `../restore` です。
 *
 * 一方通行にしていた理由は2つあり、どちらも本物でした——取り直す在庫が
 * 残っているとは限らないこと、行き来できる状態は数え間違いを呼ぶこと。
 * `restoreCancelledOrder` はその両方を潰してあります（新規注文と同じ
 * 取り方をして、足りなければ何も変えずに断る）。
 *
 * No money moves here — the refund is issued by hand in Square.
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "注文が見つかりません" }, { status: 404 });
    }

    const result = await cancelOrderAndReleaseStock(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof OrderCancelError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Order cancel error:", error);
    return NextResponse.json(
      { error: "キャンセル処理に失敗しました" },
      { status: 500 }
    );
  }
}
