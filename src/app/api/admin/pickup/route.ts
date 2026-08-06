import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { eventDates, orderItems, orders, products } from "@/db/schema";
import { getActiveEvent } from "@/lib/queries";
import { todayInJST } from "@/lib/utils";

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

    const today = todayInJST();

    const [todayDate] = await db
      .select()
      .from(eventDates)
      .where(
        and(
          eq(eventDates.event_id, event.id),
          eq(eventDates.pickup_date, today)
        )
      )
      .limit(1);

    if (!todayDate) {
      return NextResponse.json({ event, today, event_date: null, orders: [] });
    }

    const orderRows = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.event_date_id, todayDate.id),
          eq(orders.order_status, "confirmed")
        )
      )
      .orderBy(asc(orders.customer_name));

    const itemRows = orderRows.length
      ? await db
          .select({ item: orderItems, product: products })
          .from(orderItems)
          .innerJoin(products, eq(products.id, orderItems.product_id))
          .where(
            inArray(
              orderItems.order_id,
              orderRows.map((o) => o.id)
            )
          )
      : [];

    const itemsByOrder = new Map<string, unknown[]>();
    for (const row of itemRows) {
      const list = itemsByOrder.get(row.item.order_id) ?? [];
      list.push({ ...row.item, product: row.product });
      itemsByOrder.set(row.item.order_id, list);
    }

    return NextResponse.json({
      event,
      today,
      event_date: todayDate,
      orders: orderRows.map((o) => ({
        ...o,
        order_items: itemsByOrder.get(o.id) ?? [],
      })),
    });
  } catch (error) {
    console.error("Pickup load error:", error);
    return NextResponse.json(
      { error: "受取情報の取得に失敗しました" },
      { status: 500 }
    );
  }
}
