import { NextRequest, NextResponse } from "next/server";
import { OrderRestoreError, restoreCancelledOrder } from "@/lib/orders";
import { isUuid } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * キャンセルを取り消して、注文を元に戻す。
 *
 * 押し間違い——隣の方の注文を消してしまった——のための口です。無いと、
 * その場で注文を作り直すことになり、注文番号も決済の記録も合わなくなります。
 *
 * 在庫はキャンセルのときに戻してあるので、ここで取り直します。そのあいだに
 * 他の方が買っていれば戻せません。そのときは何も変えずに、どの商品が
 * いくつ足りないかを返します。
 *
 * お金は動きません。既に Square で返金済みなら、そちらは戻りません。
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

    const result = await restoreCancelledOrder(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof OrderRestoreError) {
      return NextResponse.json(
        { error: error.message, details: error.details },
        { status: 400 }
      );
    }
    console.error("Order restore error:", error);
    return NextResponse.json(
      { error: "キャンセルの取り消しに失敗しました" },
      { status: 500 }
    );
  }
}
