import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { dailyProductInventory, eventDates, events, products } from "@/db/schema";
import { isUuid } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Everything the product-selection screen needs for one pickup date:
 * the date itself, its parent event, and the visible inventory rows.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ dateId: string }> }
) {
  try {
    const { dateId } = await params;

    // Postgres はこの形でないものを型エラーで弾くので、問い合わせる前に見る。
    // 壊れたリンクを踏んだお客様に出すべきは 500 ではなく「見つかりません」。
    if (!isUuid(dateId)) {
      return NextResponse.json(
        { error: "指定された受取日が見つかりません" },
        { status: 404 }
      );
    }

    const [row] = await db
      .select({ event_date: eventDates, event: events })
      .from(eventDates)
      .innerJoin(events, eq(events.id, eventDates.event_id))
      .where(eq(eventDates.id, dateId))
      .limit(1);

    if (!row) {
      return NextResponse.json(
        { error: "指定された受取日が見つかりません" },
        { status: 404 }
      );
    }

    const inventoryRows = await db
      .select({ inventory: dailyProductInventory, product: products })
      .from(dailyProductInventory)
      .innerJoin(products, eq(products.id, dailyProductInventory.product_id))
      .where(
        and(
          eq(dailyProductInventory.event_date_id, dateId),
          eq(dailyProductInventory.is_hidden, false),
          eq(products.is_active, true)
        )
      )
      .orderBy(asc(products.sort_order));

    return NextResponse.json({
      event_date: row.event_date,
      event: row.event,
      inventory: inventoryRows.map((r) => ({ ...r.inventory, product: r.product })),
    });
  } catch (error) {
    console.error("Reserve data fetch error:", error);
    return NextResponse.json(
      { error: "予約情報の取得中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
