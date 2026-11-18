import { NextResponse } from "next/server";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  dailyProductInventory,
  eventDates,
  orderItems,
  orders,
  products,
} from "@/db/schema";
import { getActiveEvent } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const event = await getActiveEvent();
    if (!event) {
      return NextResponse.json(
        { error: "現在開催中のイベントはありません" },
        { status: 404 }
      );
    }

    const dates = await db
      .select()
      .from(eventDates)
      .where(
        and(eq(eventDates.event_id, event.id), eq(eventDates.is_active, true))
      )
      .orderBy(asc(eventDates.pickup_date));

    const inventory = dates.length
      ? (
          await db
            .select({ inventory: dailyProductInventory, product: products })
            .from(dailyProductInventory)
            .innerJoin(
              products,
              eq(products.id, dailyProductInventory.product_id)
            )
            .where(
              inArray(
                dailyProductInventory.event_date_id,
                dates.map((d) => d.id)
              )
            )
            .orderBy(asc(products.sort_order))
        ).map((r) => ({ ...r.inventory, product: r.product }))
      : [];

    /*
      テイクアウト・イートインの内訳。

      予約数（reserved_quantity）は提供区分を持たないので、注文から数え直します。
      数えるのは在庫を押さえている注文、つまりキャンセル以外（仮予約も含む）。
      予約数を増減させているのと同じ条件なので、両方を足せば予約数に一致します。
      当日カウンターで区分を切り替えた注文は、切り替えたあとの区分で数えます。
    */
    const byStyle = dates.length
      ? (
          await db
            .select({
              event_date_id: orders.event_date_id,
              product_id: orderItems.product_id,
              dining_style: orders.dining_style,
              quantity: sql<number>`sum(${orderItems.quantity})::int`,
            })
            .from(orderItems)
            .innerJoin(orders, eq(orders.id, orderItems.order_id))
            .where(
              and(
                inArray(
                  orders.event_date_id,
                  dates.map((d) => d.id)
                ),
                ne(orders.order_status, "cancelled")
              )
            )
            .groupBy(
              orders.event_date_id,
              orderItems.product_id,
              orders.dining_style
            )
        ).map((r) => ({ ...r, quantity: Number(r.quantity) }))
      : [];

    return NextResponse.json({ event, dates, inventory, by_style: byStyle });
  } catch (error) {
    console.error("Production load error:", error);
    return NextResponse.json(
      { error: "製造計画の取得に失敗しました" },
      { status: 500 }
    );
  }
}
