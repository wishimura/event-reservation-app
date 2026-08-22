import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  dailyProductInventory,
  eventDates,
  orderItems,
  orders,
} from "@/db/schema";

export const dynamic = "force-dynamic";

class CancelError extends Error {}

/**
 * Cancels an order and hands its stock back.
 *
 * Cancellation is one-way on purpose. Un-cancelling would have to re-reserve
 * stock that may have been taken in the meantime, and a status that can be
 * toggled invites the double-count bugs that reversible counters are prone to.
 * Re-book the customer instead.
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const result = await db.transaction(async (tx) => {
      const [order] = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, id))
        .limit(1);

      if (!order) {
        throw new CancelError("注文が見つかりません");
      }
      if (order.order_status === "cancelled") {
        throw new CancelError("この注文はすでにキャンセル済みです");
      }

      const items = await tx
        .select()
        .from(orderItems)
        .where(eq(orderItems.order_id, id));

      // Release what this order was holding. The CHECK constraint keeps
      // reserved_quantity from going negative if anything is inconsistent.
      for (const item of items) {
        await tx
          .update(dailyProductInventory)
          .set({
            reserved_quantity: sql`GREATEST(0, ${dailyProductInventory.reserved_quantity} - ${item.quantity})`,
            is_sold_out: false,
          })
          .where(
            and(
              eq(dailyProductInventory.event_date_id, order.event_date_id),
              eq(dailyProductInventory.product_id, item.product_id)
            )
          );
      }

      // Anything still at capacity stays sold out.
      await tx
        .update(dailyProductInventory)
        .set({ is_sold_out: true })
        .where(
          and(
            eq(dailyProductInventory.event_date_id, order.event_date_id),
            sql`${dailyProductInventory.reserved_quantity} >= ${dailyProductInventory.production_quantity}`
          )
        );

      const [cancelled] = await tx
        .update(orders)
        .set({ order_status: "cancelled" })
        .where(eq(orders.id, id))
        .returning();

      // Freeing stock can reopen a date that had closed.
      const inventory = await tx
        .select()
        .from(dailyProductInventory)
        .where(
          and(
            eq(dailyProductInventory.event_date_id, order.event_date_id),
            eq(dailyProductInventory.is_hidden, false)
          )
        );

      if (inventory.length > 0) {
        const allSoldOut = inventory.every((i) => i.is_sold_out);
        const anyNearThreshold = inventory.some((i) => {
          const remaining = i.production_quantity - i.reserved_quantity;
          return remaining > 0 && remaining <= i.warning_threshold;
        });

        await tx
          .update(eventDates)
          .set({
            reservation_status: allSoldOut
              ? "closed"
              : anyNearThreshold
                ? "few_left"
                : "open",
          })
          .where(eq(eventDates.id, order.event_date_id));
      }

      return { order: cancelled, released: items.length };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CancelError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Order cancel error:", error);
    return NextResponse.json(
      { error: "キャンセル処理に失敗しました" },
      { status: 500 }
    );
  }
}
