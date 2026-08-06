import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { eventDates, orderItems, orders, products } from "@/db/schema";
import { getActiveEvent, getAllEventDates } from "@/lib/queries";

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

    const dates = await getAllEventDates(event.id);

    const orderRows = await db
      .select({ order: orders, event_date: eventDates })
      .from(orders)
      .innerJoin(eventDates, eq(eventDates.id, orders.event_date_id))
      .where(eq(orders.event_id, event.id))
      .orderBy(desc(orders.created_at));

    const itemRows = orderRows.length
      ? await db
          .select({ item: orderItems, product: products })
          .from(orderItems)
          .innerJoin(products, eq(products.id, orderItems.product_id))
          .where(
            inArray(
              orderItems.order_id,
              orderRows.map((r) => r.order.id)
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
      dates,
      orders: orderRows.map((r) => ({
        ...r.order,
        event_date: r.event_date,
        order_items: itemsByOrder.get(r.order.id) ?? [],
      })),
    });
  } catch (error) {
    console.error("Orders load error:", error);
    return NextResponse.json(
      { error: "注文一覧の取得に失敗しました" },
      { status: 500 }
    );
  }
}
