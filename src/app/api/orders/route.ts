import { NextRequest, NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { eventDates, events, orders } from "@/db/schema";
import { isUniqueViolation } from "@/lib/db-errors";
import { sendOrderEmails } from "@/lib/email";
import {
  cancelOrderAndReleaseStock,
  holdStockAndCreateOrder,
  OrderValidationError,
} from "@/lib/orders";
import {
  chargeOrder,
  isSquareEnabled,
  SquarePaymentError,
} from "@/lib/square";
import {
  generateOrderNumber,
  isPastReservationDeadline,
  parsePickupTimeSlots,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

interface OrderRequestBody {
  event_id: string;
  event_date_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  /** One of the event's configured pickup times, when it offers any. */
  pickup_time_slot?: string;
  payment_method: "cash" | "credit_card";
  /** Set by the Square Web Payments SDK when card payment is switched on. */
  payment_source_id?: string;
  /** 3-D Secure result from `payments.verifyBuyer()`, when the issuer gave one. */
  verification_token?: string;
  items: Array<{ product_id: string; quantity: number }>;
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

  /**
   * Card payment only switches on once the shop's Square credentials are in
   * place. Until then reservations keep working exactly as before, paid at
   * the counter, so a missing credential can never take the site down.
   */
  const payByCard = isSquareEnabled();

  if (payByCard && !body.payment_source_id) {
    return NextResponse.json(
      { error: "カード情報が読み取れませんでした。もう一度お試しください。" },
      { status: 400 }
    );
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
        if (isPastReservationDeadline(eventDate.reservation_close_at)) {
          throw new OrderValidationError(
            "この受取日のご予約受付は終了しました"
          );
        }

        /**
         * Checked against the event rather than trusted from the browser: the
         * shop may have rewritten its times while this page sat open, and a
         * slot nobody is staffing is worse than asking again.
         */
        const timeSlots = parsePickupTimeSlots(event.pickup_time_slots);
        const pickupTimeSlot = body.pickup_time_slot?.trim() ?? "";

        if (timeSlots.length > 0 && !timeSlots.includes(pickupTimeSlot)) {
          throw new OrderValidationError(
            pickupTimeSlot
              ? "選択された受取時間は現在ご利用いただけません。お手数ですが選び直してください"
              : "受取時間を選んでください"
          );
        }

        /* ------------- 2. hold the stock and write the order -------------- */
        // Shared with the console's counter-sale form, so the two can never
        // disagree about what taking stock means.
        const { order, items } = await holdStockAndCreateOrder(tx, {
          event_id: body.event_id,
          event_date_id: body.event_date_id,
          quantityByProduct,
          customer_name: body.customer_name,
          customer_email: body.customer_email,
          customer_phone: body.customer_phone,
          pickup_time_slot: pickupTimeSlot || null,
          // Stock is held before the card is charged, so a card order starts
          // provisional and is confirmed once Square accepts the payment.
          // Without Square configured the reservation is simply confirmed and
          // settled at the counter.
          payment_status: payByCard ? "pending" : "paid",
          payment_method: payByCard ? "credit_card" : "cash",
          order_status: payByCard ? "temporary" : "confirmed",
          pickup_status: "not_picked_up",
          paid_at: payByCard ? null : new Date(),
          source: "online",
        });

        return { order, items, event_date: eventDate, event };
      });

      let { order } = created;
      const { items, event_date, event } = created;

      /* --------------------- take the card payment ----------------------- */
      if (payByCard) {
        try {
          // The order id is the idempotency key, so a retry of this request
          // returns the original payment instead of charging a second time.
          const charge = await chargeOrder({
            sourceId: body.payment_source_id!,
            amountYen: order.total_amount,
            idempotencyKey: order.id,
            referenceId: order.order_number,
            note: `${event.name} ${event_date.pickup_date} ${order.order_number}`,
            customerEmail: order.customer_email,
            verificationToken: body.verification_token,
          });

          const [paid] = await db
            .update(orders)
            .set({
              payment_status: "paid",
              order_status: "confirmed",
              paid_at: new Date(),
              square_payment_id: charge.paymentId,
              square_receipt_url: charge.receiptUrl,
            })
            .where(eq(orders.id, order.id))
            .returning();

          order = paid;
        } catch (paymentError) {
          // The stock was already held, so give it straight back rather than
          // leaving a provisional order sitting on it.
          try {
            await cancelOrderAndReleaseStock(order.id);
          } catch (releaseError) {
            console.error(
              "Failed to release stock after a declined payment:",
              order.order_number,
              releaseError
            );
          }

          const message =
            paymentError instanceof SquarePaymentError
              ? paymentError.customerMessage
              : "決済処理に失敗しました。もう一度お試しください。";

          return NextResponse.json({ error: message }, { status: 402 });
        }
      }

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
          pickup_time_slot: order.pickup_time_slot,
          event_name: event.name,
          pickup_location: event.pickup_location,
          reservation_note: event.reservation_note,
          contact_phone: event.contact_phone,
          items,
        });
      });

      return NextResponse.json(
        {
          ...order,
          items,
          event_date,
          pickup_location: event.pickup_location,
          contact_phone: event.contact_phone,
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
