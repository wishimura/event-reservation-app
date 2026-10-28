import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { isUuid, readJsonObject } from "@/lib/http";
import type { DiningStyle } from "@/lib/types";

export const dynamic = "force-dynamic";

const ALLOWED: DiningStyle[] = ["eat_in", "takeout"];

/**
 * カウンターで、店内と持ち帰りを切り替える。
 *
 * 消費税率が決まるのは「お渡しした時点」の意思なので、ご予約時の選択は
 * あくまで予定です。当日「やっぱり持ち帰る」と言われたら、こちらが正。
 *
 * 売値はどちらも同じなので、ここで金額は1円も動きません。決済済みの注文を
 * 変えても Square 側と食い違わないのが、同額にしていることの効きどころです。
 *
 * 受け渡しが済んだあとでも変えられます。渡してから「やっぱりここで食べる」
 * と言われることがあり、そのときに直せないと税額が実態と合いません。
 * 取り消された注文だけは変えられません。
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
    if (!body) {
      return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
    }

    const diningStyle = body.dining_style as DiningStyle;
    if (!ALLOWED.includes(diningStyle)) {
      return NextResponse.json(
        { error: "店内かお持ち帰りかを指定してください" },
        { status: 400 }
      );
    }

    const [existing] = await db
      .select()
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: "注文が見つかりません" }, { status: 404 });
    }
    if (existing.order_status === "cancelled") {
      return NextResponse.json(
        { error: "キャンセル済みの注文は変更できません" },
        { status: 400 }
      );
    }

    // 同じ値への変更は、変更時刻を書き換えない。押し間違いで「当日変えた」
    // 記録がつくと、税額の根拠を読むときに邪魔になる。
    if (existing.dining_style === diningStyle) {
      return NextResponse.json(existing);
    }

    const [updated] = await db
      .update(orders)
      .set({ dining_style: diningStyle, dining_style_changed_at: new Date() })
      .where(eq(orders.id, id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Dining style update error:", error);
    return NextResponse.json(
      { error: "お召し上がり方法の変更に失敗しました" },
      { status: 500 }
    );
  }
}
