import { NextRequest, NextResponse } from "next/server";
import { cancelOrderAndReleaseStock, OrderCancelError } from "@/lib/orders";

export const dynamic = "force-dynamic";

/**
 * Cancels an order and returns its stock to the day's allowance.
 *
 * Cancellation is one-way on purpose. Un-cancelling would have to re-reserve
 * stock that may have been taken in the meantime, and a status that can be
 * toggled invites the double-count bugs that reversible counters are prone to.
 * Re-book the customer instead.
 *
 * No money moves here — the refund is issued by hand in Square.
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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
