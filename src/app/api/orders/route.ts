import { NextRequest, NextResponse, after } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  dailyProductInventory,
  eventDates,
  events,
  orderItems,
  orders,
  products,
} from "@/db/schema";
import { sendOrderEmails } from "@/lib/email";
import { generateOrderNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface OrderRequestBody {
  event_id: string;
  event_date_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  payment_method: "cash" | "credit_card";
  items: Array<{ product_id: string; quantity: number }>;
}

/** Thrown for conditions the customer can act on — surfaced as a 400. */
class OrderValidationError extends Error {
  details?: string[];
  constructor(message: string, details?: string[]) {
    super(message);
    this.name = "OrderValidationError";
    this.details = details;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

export async function POST(request: NextRequest) {
  let body: OrderRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  if (
    !body.event_id ||
    !body.event_date_id ||
    !body.customer_name ||
    !body.customer_email ||
    !body.customer_phone ||
    !body.payment_method ||
    !Array.isArray(body.items) ||
    body.items.length === 0
  ) {
    return NextResponse.json(
      { error: "必須項目が不足しています" },
      { status: 400 }
    );
  }

  if (body.payment_method !== "cash" && body.payment_method !== "credit_card") {
    return NextResponse.json({ error: "支払方法が不正です" }, { status: 400 });
  }

  // Collapse duplicate product_ids so each product maps to exactly one update.
  const quantityByProduct = new Map<string, number>();
  for (const item of body.items) {
    if (
      !item.product_id ||
      !Number.isInteger(item.quantity) ||
      item.quantity < 1
    ) {
      return NextResponse.json({ error: "商品情報が不正です" }, { status: 400 });
    }
    quantityByProduct.set(
      item.product_id,
      (quantityByProduct.get(item.product_id) ?? 0) + item.quantity
    );
  }

  // The whole order replays on order-number collision; stock failures don't retry.
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const created = await db.transaction(async (tx) => {
        /* ----------------------- 1. validate the date ----------------------- */
        const [eventDate] = await tx
          .select()
          .from(eventDates)
          .where(eq(eventDates.id, body.event_date_id))
          .limit(1);

        if (!eventDate || eventDate.event_id !== body.event_id) {
          throw new OrderValidationError("指定された受取日が見つかりません");
        }

        const [event] = await tx
          .select()
          .from(events)
          .where(eq(events.id, body.event_id))
          .limit(1);

        if (!event) {
          throw new OrderValidationError("イベントが見つかりません");
        }
        if (!eventDate.is_active || eventDate.reservation_status === "closed") {
          throw new OrderValidationError("この受取日は現在受付を終了しています");
        }

        /* ------------------ 2. resolve products and prices ------------------ */
        const productIds = [...quantityByProduct.keys()];
        const rows = await tx
          .select({ inventory: dailyProductInventory, product: products })
          .from(dailyProductInventory)
          .innerJoin(products, eq(products.id, dailyProductInventory.product_id))
          .where(
            and(
              eq(dailyProductInventory.event_date_id, body.event_date_id),
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

        /* ----------- 3. reserve stock atomically, one row at a time ---------- */
        // Deterministic order avoids deadlocks between concurrent orders.
        const sortedRows = [...rows].sort((a, b) =>
          a.inventory.id.localeCompare(b.inventory.id)
        );

        const shortages: string[] = [];

        for (const row of sortedRows) {
          const qty = quantityByProduct.get(row.product.id)!;

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
              ? Math.max(
                  0,
                  current.production_quantity - current.reserved_quantity
                )
              : 0;

            shortages.push(
              `「${row.product.name}」の在庫が不足しています（残り${remaining}個）`
            );
          }
        }

        if (shortages.length > 0) {
          throw new OrderValidationError(
            "在庫が不足している商品があります",
            shortages
          );
        }

        /* -------------------------- 4. the order --------------------------- */
        const lineItems = sortedRows.map((row) => {
          const quantity = quantityByProduct.get(row.product.id)!;
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
            event_id: body.event_id,
            event_date_id: body.event_date_id,
            customer_name: body.customer_name,
            customer_email: body.customer_email,
            customer_phone: body.customer_phone,
            total_amount: totalAmount,
            // NOTE: carried over from the Supabase implementation — cash orders
            // are marked paid at reservation time, not at pickup.
            payment_status: "paid",
            payment_method: body.payment_method,
            order_status: "confirmed",
            pickup_status: "not_picked_up",
            paid_at: new Date(),
          })
          .returning();

        const insertedItems = await tx
          .insert(orderItems)
          .values(lineItems.map((i) => ({ ...i, order_id: order.id })))
          .returning();

        /* ---------------- 5. refresh sold-out and date status --------------- */
        await tx
          .update(dailyProductInventory)
          .set({ is_sold_out: true })
          .where(
            and(
              eq(dailyProductInventory.event_date_id, body.event_date_id),
              sql`${dailyProductInventory.reserved_quantity} >= ${dailyProductInventory.production_quantity}`
            )
          );

        const currentInventory = await tx
          .select()
          .from(dailyProductInventory)
          .where(
            and(
              eq(dailyProductInventory.event_date_id, body.event_date_id),
              eq(dailyProductInventory.is_hidden, false)
            )
          );

        if (currentInventory.length > 0) {
          const allSoldOut = currentInventory.every((i) => i.is_sold_out);
          const anyNearThreshold = currentInventory.some((i) => {
            const remaining = i.production_quantity - i.reserved_quantity;
            return remaining > 0 && remaining <= i.warning_threshold;
          });

          const newStatus = allSoldOut
            ? "closed"
            : anyNearThreshold
              ? "few_left"
              : "open";

          if (newStatus !== eventDate.reservation_status) {
            await tx
              .update(eventDates)
              .set({ reservation_status: newStatus })
              .where(eq(eventDates.id, body.event_date_id));
          }
        }

        return { order, items: insertedItems, event_date: eventDate, event };
      });

      const { order, items, event_date, event } = created;

      // Sent after the response so the customer is not kept waiting on the
      // mail provider. A failure here never invalidates the reservation.
      after(async () => {
        await sendOrderEmails({
          order_number: order.order_number,
          customer_name: order.customer_name,
          customer_email: order.customer_email,
          customer_phone: order.customer_phone,
          total_amount: order.total_amount,
          pickup_date: event_date.pickup_date,
          event_name: event.name,
          pickup_location: event.pickup_location,
          reservation_note: event.reservation_note,
          items,
        });
      });

      return NextResponse.json(
        {
          ...order,
          items,
          event_date,
          pickup_location: event.pickup_location,
        },
        { status: 201 }
      );
    } catch (error) {
      if (error instanceof OrderValidationError) {
        return NextResponse.json(
          { error: error.message, details: error.details },
          { status: 400 }
        );
      }

      if (isUniqueViolation(error) && attempt < MAX_ATTEMPTS) {
        // Order number collided — regenerate and replay the whole transaction.
        continue;
      }

      console.error("Order creation error:", error);
      return NextResponse.json(
        { error: "注文処理中にエラーが発生しました" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    { error: "注文処理中にエラーが発生しました" },
    { status: 500 }
  );
}
