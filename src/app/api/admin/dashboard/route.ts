import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { dailyProductInventory, eventDates, orders, products } from "@/db/schema";
import { getActiveEvent, getAllEventDates } from "@/lib/queries";
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

    const dates = await getAllEventDates(event.id);
    const today = todayInJST();

    const orderRows = await db
      .select({ order: orders, event_date: eventDates })
      .from(orders)
      .innerJoin(eventDates, eq(eventDates.id, orders.event_date_id))
      .where(
        and(
          eq(orders.event_id, event.id),
          inArray(orders.order_status, ["confirmed", "temporary"])
        )
      )
      .orderBy(desc(orders.created_at));

    const upcomingDateIds = dates
      .filter((d) => d.pickup_date >= today)
      .map((d) => d.id);

    const lowStockItems = upcomingDateIds.length
      ? (
          await db
            .select({ inventory: dailyProductInventory, product: products })
            .from(dailyProductInventory)
            .innerJoin(
              products,
              eq(products.id, dailyProductInventory.product_id)
            )
            .where(
              and(
                inArray(dailyProductInventory.event_date_id, upcomingDateIds),
                eq(dailyProductInventory.is_sold_out, false),
                eq(dailyProductInventory.is_hidden, false),
                sql`${dailyProductInventory.production_quantity} - ${dailyProductInventory.reserved_quantity} > 0`,
                sql`${dailyProductInventory.production_quantity} - ${dailyProductInventory.reserved_quantity} <= ${dailyProductInventory.warning_threshold}`
              )
            )
            .orderBy(asc(products.sort_order))
        ).map((r) => ({ ...r.inventory, product: r.product }))
      : [];

    /**
     * Capacity 0 on a visible product reads to customers as SOLD OUT, so a
     * product added and left at the default never sells and nothing says why.
     * Rows the operator deliberately hid are excluded — that is a choice,
     * not the trap.
     */
    const zeroCapacity = upcomingDateIds.length
      ? await db
          .select({
            product_name: products.name,
            pickup_date: eventDates.pickup_date,
          })
          .from(dailyProductInventory)
          .innerJoin(
            products,
            eq(products.id, dailyProductInventory.product_id)
          )
          .innerJoin(
            eventDates,
            eq(eventDates.id, dailyProductInventory.event_date_id)
          )
          .where(
            and(
              inArray(dailyProductInventory.event_date_id, upcomingDateIds),
              eq(eventDates.is_active, true),
              eq(products.is_active, true),
              eq(dailyProductInventory.is_hidden, false),
              eq(dailyProductInventory.production_quantity, 0)
            )
          )
          .orderBy(asc(eventDates.pickup_date), asc(products.sort_order))
      : [];

    return NextResponse.json({
      event,
      dates,
      today,
      zeroCapacity,
      orders: orderRows.map((r) => ({ ...r.order, event_date: r.event_date })),
      lowStockItems,
    });
  } catch (error) {
    console.error("Dashboard load error:", error);
    return NextResponse.json(
      { error: "ダッシュボードの取得に失敗しました" },
      { status: 500 }
    );
  }
}
