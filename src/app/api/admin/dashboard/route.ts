import { NextResponse } from "next/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
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

    /**
     * Counted in the database rather than in the browser.
     *
     * This screen only ever showed totals, but it was fetching every order
     * of the whole event to add them up — approaching a megabyte by the end
     * of a run, onto whatever phone the shop happens to have open. The
     * numbers are the same; the page now receives only the numbers.
     */
    const live = and(
      eq(orders.event_id, event.id),
      inArray(orders.order_status, ["confirmed", "temporary"])
    );

    const byDate = await db
      .select({
        event_date_id: orders.event_date_id,
        order_count: sql<number>`count(*)::int`,
        total_amount: sql<number>`coalesce(sum(${orders.total_amount}), 0)::int`,
      })
      .from(orders)
      .where(live)
      .groupBy(orders.event_date_id);

    /**
     * Orders that took stock and then stopped.
     *
     * A card order holds the day's stock from the moment it is written,
     * and is confirmed once Square accepts the payment. Almost always that
     * is the same second. When it is not — the connection died between the
     * two, or releasing the stock afterwards failed as well — the order
     * sits unpaid on stock nobody can buy, and nothing says so.
     *
     * Half an hour is far longer than the slowest real payment, so anything
     * older is stuck. Cancelling it in the order list hands the stock back.
     */
    const stuckOrders = await db
      .select({
        id: orders.id,
        order_number: orders.order_number,
        customer_name: orders.customer_name,
        total_amount: orders.total_amount,
        created_at: orders.created_at,
      })
      .from(orders)
      .where(
        and(
          eq(orders.event_id, event.id),
          eq(orders.order_status, "temporary"),
          eq(orders.payment_status, "pending"),
          sql`${orders.created_at} < now() - interval '30 minutes'`
        )
      )
      .orderBy(asc(orders.created_at))
      .limit(50);

    const [totals] = await db
      .select({
        total_sales: sql<number>`coalesce(sum(${orders.total_amount}) filter (where ${orders.payment_status} = 'paid'), 0)::int`,
        today_reservations: sql<number>`count(*) filter (where ${eventDates.pickup_date} = ${today} and ${orders.order_status} = 'confirmed')::int`,
        today_picked_up: sql<number>`count(*) filter (where ${eventDates.pickup_date} = ${today} and ${orders.order_status} = 'confirmed' and ${orders.pickup_status} = 'picked_up')::int`,
      })
      .from(orders)
      .innerJoin(eventDates, eq(eventDates.id, orders.event_date_id))
      .where(live);

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
      stuckOrders,
      summary: {
        total_sales: totals?.total_sales ?? 0,
        today_reservations: totals?.today_reservations ?? 0,
        today_picked_up: totals?.today_picked_up ?? 0,
        by_date: byDate,
      },
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
