import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  dailyProductInventory,
  orderItems,
  orders,
} from "@/db/schema";
import { refreshDateReservationStatus } from "@/lib/inventory";

export class OrderCancelError extends Error {}

/**
 * Cancels an order and hands its stock back to the day's allowance.
 *
 * Two callers share this: the console's cancel button, and the reservation
 * endpoint when a card is declined after stock has already been reserved.
 * Both need exactly the same repair, so it lives in one place.
 *
 * Money is never touched here. Refunds are issued by hand in the Square
 * dashboard, so a cancelled order keeps its square_payment_id for the
 * operator to look up.
 */
export async function cancelOrderAndReleaseStock(orderId: string): Promise<{
  released: number;
}> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!order) {
      throw new OrderCancelError("注文が見つかりません");
    }
    if (order.order_status === "cancelled") {
      throw new OrderCancelError("この注文はすでにキャンセル済みです");
    }

    const items = await tx
      .select()
      .from(orderItems)
      .where(eq(orderItems.order_id, orderId));

    // GREATEST keeps this safe even if the counts were somehow already low;
    // the CHECK constraint would otherwise abort the whole cancellation.
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

    await tx
      .update(orders)
      .set({ order_status: "cancelled" })
      .where(eq(orders.id, orderId));

    // Freeing stock can reopen a date that had closed.
    await refreshDateReservationStatus(tx, order.event_date_id);

    return { released: items.length };
  });
}
