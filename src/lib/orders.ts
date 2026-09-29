import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  dailyProductInventory,
  orderItems,
  orders,
  products,
} from "@/db/schema";
import { refreshDateReservationStatus } from "@/lib/inventory";
import { generateOrderNumber } from "@/lib/utils";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Conditions the caller can act on — surfaced to the customer or operator. */
export class OrderValidationError extends Error {
  details?: string[];
  constructor(message: string, details?: string[]) {
    super(message);
    this.name = "OrderValidationError";
    this.details = details;
  }
}

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

/**
 * Takes the stock and writes the order, inside a transaction the caller owns.
 *
 * Both ways an order can arrive share this: the customer booking on the site,
 * and the shop recording a sale made over the counter. They differ in how the
 * money was handled, not in what happens to the day's stock, and keeping the
 * stock arithmetic in one place is what stops the two drifting apart.
 *
 * The caller has already decided the date is open. This decides only whether
 * there is stock left, and refuses the whole order if any line is short.
 */
export async function holdStockAndCreateOrder(
  tx: Transaction,
  params: {
    event_id: string;
    event_date_id: string;
    quantityByProduct: Map<string, number>;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    pickup_time_slot: string | null;
    payment_status: "pending" | "paid";
    payment_method: "cash" | "credit_card";
    order_status: "temporary" | "confirmed";
    pickup_status: "not_picked_up" | "picked_up";
    paid_at: Date | null;
    source: "online" | "walk_in";
  }
) {
  const productIds = [...params.quantityByProduct.keys()];

  const rows = await tx
    .select({ inventory: dailyProductInventory, product: products })
    .from(dailyProductInventory)
    .innerJoin(products, eq(products.id, dailyProductInventory.product_id))
    .where(
      and(
        eq(dailyProductInventory.event_date_id, params.event_date_id),
        inArray(dailyProductInventory.product_id, productIds),
        eq(dailyProductInventory.is_hidden, false),
        eq(products.is_active, true)
      )
    );

  if (rows.length !== productIds.length) {
    throw new OrderValidationError(
      "選択できない商品が含まれています。もう一度お試しください"
    );
  }

  // Deterministic order avoids deadlocks between concurrent orders.
  const sortedRows = [...rows].sort((a, b) =>
    a.inventory.id.localeCompare(b.inventory.id)
  );

  const shortages: string[] = [];

  for (const row of sortedRows) {
    const qty = params.quantityByProduct.get(row.product.id)!;

    // Postgres re-evaluates this WHERE after any concurrent transaction
    // releases the row lock, so two simultaneous orders can never push
    // reserved_quantity past production_quantity.
    const updated = await tx
      .update(dailyProductInventory)
      .set({
        reserved_quantity: sql`${dailyProductInventory.reserved_quantity} + ${qty}`,
      })
      .where(
        and(
          eq(dailyProductInventory.id, row.inventory.id),
          eq(dailyProductInventory.is_sold_out, false),
          sql`${dailyProductInventory.reserved_quantity} + ${qty} <= ${dailyProductInventory.production_quantity}`
        )
      )
      .returning();

    if (updated.length === 0) {
      const [current] = await tx
        .select()
        .from(dailyProductInventory)
        .where(eq(dailyProductInventory.id, row.inventory.id))
        .limit(1);

      const remaining = current
        ? Math.max(0, current.production_quantity - current.reserved_quantity)
        : 0;

      shortages.push(
        `「${row.product.name}」の在庫が不足しています（残り${remaining}個）`
      );
    }
  }

  if (shortages.length > 0) {
    throw new OrderValidationError("在庫が不足している商品があります", shortages);
  }

  const lineItems = sortedRows.map((row) => {
    const quantity = params.quantityByProduct.get(row.product.id)!;
    return {
      product_id: row.product.id,
      product_name_snapshot: row.product.name,
      unit_price: row.product.price,
      quantity,
      subtotal: row.product.price * quantity,
    };
  });

  const totalAmount = lineItems.reduce((sum, i) => sum + i.subtotal, 0);

  const [order] = await tx
    .insert(orders)
    .values({
      order_number: generateOrderNumber(),
      event_id: params.event_id,
      event_date_id: params.event_date_id,
      customer_name: params.customer_name,
      customer_email: params.customer_email,
      customer_phone: params.customer_phone,
      pickup_time_slot: params.pickup_time_slot,
      total_amount: totalAmount,
      payment_status: params.payment_status,
      payment_method: params.payment_method,
      order_status: params.order_status,
      pickup_status: params.pickup_status,
      paid_at: params.paid_at,
      source: params.source,
    })
    .returning();

  const items = await tx
    .insert(orderItems)
    .values(lineItems.map((i) => ({ ...i, order_id: order.id })))
    .returning();

  // Anything that just hit its cap is sold out, and the day may have closed.
  await tx
    .update(dailyProductInventory)
    .set({ is_sold_out: true })
    .where(
      and(
        eq(dailyProductInventory.event_date_id, params.event_date_id),
        sql`${dailyProductInventory.reserved_quantity} >= ${dailyProductInventory.production_quantity}`
      )
    );

  await refreshDateReservationStatus(tx, params.event_date_id);

  return { order, items };
}
