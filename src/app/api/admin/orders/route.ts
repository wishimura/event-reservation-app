import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { eventDates, events, orderItems, orders } from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { holdStockAndCreateOrder, OrderValidationError } from "@/lib/orders";
import { getActiveEvent, getAllEventDates } from "@/lib/queries";
import { parsePickupTimeSlots } from "@/lib/utils";

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

    /**
     * The lines, without the product they point at.
     *
     * Each line already carries the name and the price as they stood when
     * the order was placed, which is what the screen shows and what the CSV
     * writes out. Joining the product on top of that added a copy of it to
     * every line — four hundred kilobytes of an event's worth of orders,
     * none of it read, all of it over the shop's wifi onto a phone.
     */
    const itemRows = orderRows.length
      ? await db
          .select()
          .from(orderItems)
          .where(
            inArray(
              orderItems.order_id,
              orderRows.map((r) => r.order.id)
            )
          )
      : [];

    const itemsByOrder = new Map<string, unknown[]>();
    for (const item of itemRows) {
      const list = itemsByOrder.get(item.order_id) ?? [];
      list.push(item);
      itemsByOrder.set(item.order_id, list);
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

interface WalkInBody {
  event_date_id: string;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  pickup_time_slot?: string;
  payment_method?: "cash" | "credit_card";
  /** Sold and handed over at the same time, which is the usual counter sale. */
  handed_over?: boolean;
  items: Array<{ product_id: string; quantity: number }>;
}

/**
 * Records a sale made at the counter.
 *
 * People turn up without having booked, and the shop sells them what is left.
 * Those sales come out of the same day's stock as the reservations, so if
 * they are not written down the production plan and the remaining counts both
 * drift away from what is actually on the shelf.
 *
 * No money moves here and no email is sent: it has already been paid for at
 * the till, in front of the customer. This only writes down what happened.
 *
 * The date's deadline is deliberately not checked. Its job is to stop
 * customers booking a day the kitchen has already started on; the shop
 * recording what it just sold is the opposite situation.
 */
export async function POST(request: NextRequest) {
  let body: WalkInBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  if (!body.event_date_id) {
    return NextResponse.json({ error: "受取日を選んでください" }, { status: 400 });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "商品を1つ以上選んでください" }, { status: 400 });
  }

  const quantityByProduct = new Map<string, number>();
  for (const item of body.items) {
    if (!item.product_id || !Number.isInteger(item.quantity) || item.quantity < 1) {
      return NextResponse.json({ error: "数量が不正です" }, { status: 400 });
    }
    quantityByProduct.set(
      item.product_id,
      (quantityByProduct.get(item.product_id) ?? 0) + item.quantity
    );
  }

  const paymentMethod = body.payment_method === "credit_card" ? "credit_card" : "cash";

  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const created = await db.transaction(async (tx) => {
        const [eventDate] = await tx
          .select()
          .from(eventDates)
          .where(eq(eventDates.id, body.event_date_id))
          .limit(1);

        if (!eventDate) {
          throw new OrderValidationError("指定された受取日が見つかりません");
        }

        const [event] = await tx
          .select()
          .from(events)
          .where(eq(events.id, eventDate.event_id))
          .limit(1);

        if (!event) {
          throw new OrderValidationError("イベントが見つかりません");
        }

        // Offered as a convenience, not required: a counter sale is handed
        // over on the spot and has no pickup time to speak of.
        const slots = parsePickupTimeSlots(event.pickup_time_slots);
        const requested = body.pickup_time_slot?.trim() ?? "";
        if (requested && !slots.includes(requested)) {
          throw new OrderValidationError("選択できない受取時間です");
        }

        const handedOver = body.handed_over !== false;

        return holdStockAndCreateOrder(tx, {
          event_id: event.id,
          event_date_id: body.event_date_id,
          quantityByProduct,
          customer_name: body.customer_name?.trim() || "店頭のお客様",
          customer_email: body.customer_email?.trim() ?? "",
          customer_phone: body.customer_phone?.trim() ?? "",
          pickup_time_slot: requested || null,
          payment_status: "paid",
          payment_method: paymentMethod,
          order_status: "confirmed",
          pickup_status: handedOver ? "picked_up" : "not_picked_up",
          paid_at: new Date(),
          source: "walk_in",
        });
      });

      return NextResponse.json(created, { status: 201 });
    } catch (error) {
      if (error instanceof OrderValidationError) {
        return NextResponse.json(
          { error: error.message, details: error.details },
          { status: 400 }
        );
      }
      if (isUniqueViolation(error) && attempt < MAX_ATTEMPTS) {
        continue; // order number collided — replay with a fresh one
      }

      console.error("Walk-in order error:", error);
      return NextResponse.json(
        { error: "注文の登録に失敗しました" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ error: "注文の登録に失敗しました" }, { status: 500 });
}
