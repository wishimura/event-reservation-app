import { NextRequest, NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { eventDates, events, orderItems, orders } from "@/db/schema";
import { isUniqueViolation, isUniqueViolationOn } from "@/lib/db-errors";
import { sendOrderEmails } from "@/lib/email";
import {
  cancelOrderAndReleaseStock,
  holdStockAndCreateOrder,
  OrderValidationError,
} from "@/lib/orders";
import {
  chargeOrder,
  type ChargeResult,
  isSquareEnabled,
  SquarePaymentError,
} from "@/lib/square";
import {
  generateOrderNumber,
  isPastReservationDeadline,
  parsePickupTimeSlots,
} from "@/lib/utils";
import { isUuid, readJsonObject } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Long enough to wait on the card issuer.
 *
 * Vercel's default is ten seconds, and this one request has to reach the
 * database in Singapore several times and then Square, which itself may be
 * waiting on the customer's bank. Being cut off partway through is the one
 * failure that could take money without leaving a reservation behind, so the
 * ceiling is raised well clear of the worst case rather than left at a
 * default that was never chosen with this in mind.
 */
export const maxDuration = 60;

/** Set by the unique index that makes a repeated attempt recognisable. */
const CLIENT_REQUEST_ID_CONSTRAINT = "orders_client_request_id_key";

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
  /**
   * The browser's id for this attempt, so a request that is sent twice —
   * a dropped connection, a customer who taps again — is recognised as the
   * same order instead of being charged a second time.
   */
  client_request_id?: string;
  items: Array<{ product_id: string; quantity: number }>;
}

export async function POST(request: NextRequest) {
  // `request.json()` は null や配列も素通しする。そこからフィールドを
  // 読むと例外になり、本来 400 で済む話が 500 になる。
  const parsed = await readJsonObject(request);
  if (!parsed) {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }
  const body = parsed as unknown as OrderRequestBody;

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

  // uuid でないものは、問い合わせた先の Postgres が型エラーで突き返す。
  // 手前で見ておかないと「見つからない」が「サーバーエラー」として出る。
  if (!isUuid(body.event_id) || !isUuid(body.event_date_id)) {
    return NextResponse.json(
      { error: "指定された受取日が見つかりません" },
      { status: 400 }
    );
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

  const clientRequestId =
    typeof body.client_request_id === "string" && body.client_request_id.trim()
      ? body.client_request_id.trim().slice(0, 100)
      : null;

  // Collapse duplicate product_ids so each product maps to exactly one update.
  const quantityByProduct = new Map<string, number>();
  for (const item of body.items) {
    if (
      !isUuid(item.product_id) ||
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
        // One round trip rather than two. Every one of them is time the
        // customer spends watching a spinner, and time the next customer in
        // the queue spends waiting for this transaction to finish.
        const [found] = await tx
          .select({ event_date: eventDates, event: events })
          .from(eventDates)
          .innerJoin(events, eq(events.id, eventDates.event_id))
          .where(eq(eventDates.id, body.event_date_id))
          .limit(1);

        if (!found || found.event_date.event_id !== body.event_id) {
          throw new OrderValidationError("指定された受取日が見つかりません");
        }

        const { event_date: eventDate, event } = found;

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
          client_request_id: clientRequestId,
        });

        return { order, items, event_date: eventDate, event };
      });

      let { order } = created;
      const { items, event_date, event } = created;

      /* --------------------- take the card payment ----------------------- */
      if (payByCard) {
        let charge;
        try {
          // The order id is the idempotency key, so a retry of this request
          // returns the original payment instead of charging a second time.
          charge = await chargeOrder({
            sourceId: body.payment_source_id!,
            amountYen: order.total_amount,
            idempotencyKey: order.id,
            referenceId: order.order_number,
            note: `${event.name} ${event_date.pickup_date} ${order.order_number}`,
            customerEmail: order.customer_email,
            verificationToken: body.verification_token,
          });
        } catch (paymentError) {
          // No money moved. The stock was already held, so give it straight
          // back rather than leaving a provisional order sitting on it.
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

        /**
         * Past this line the customer's card has been charged.
         *
         * Whatever happens while writing that down, the reservation stands:
         * cancelling it here would hand back the stock and tell someone who
         * has just paid that their payment failed, and the obvious thing for
         * them to do next is pay again. So the write is retried, and if it
         * still will not go through the customer is shown the reservation
         * they paid for while the failure is left in the log for the shop,
         * with the payment id needed to match the two up by hand.
         */
        order = await recordPayment(order, charge);
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

      if (isUniqueViolationOn(error, CLIENT_REQUEST_ID_CONSTRAINT)) {
        // This very attempt has already been through here. Whatever happened
        // to the customer's connection, the order exists and must not be
        // made — or charged — a second time.
        return respondToRepeatedAttempt(clientRequestId!);
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

type Order = typeof orders.$inferSelect;

/**
 * Writes down a payment that has already been taken.
 *
 * Retried, because by the time this runs the money is gone and the only
 * thing standing between the customer and a reservation is one UPDATE. If
 * every attempt fails the payment is logged loudly with both identifiers —
 * the shop can then find the order in the console, sitting unconfirmed, and
 * the payment in Square, and put the two together.
 */
async function recordPayment(order: Order, charge: ChargeResult): Promise<Order> {
  const paid = {
    payment_status: "paid" as const,
    order_status: "confirmed" as const,
    paid_at: new Date(),
    square_payment_id: charge.paymentId,
    square_receipt_url: charge.receiptUrl,
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const [updated] = await db
        .update(orders)
        .set(paid)
        .where(eq(orders.id, order.id))
        .returning();

      if (updated) return updated;
    } catch (error) {
      console.error(
        `Recording payment failed (attempt ${attempt}):`,
        order.order_number,
        error
      );
    }

    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }

  console.error(
    "PAYMENT TAKEN BUT NOT RECORDED — reconcile by hand:",
    `order_number=${order.order_number}`,
    `order_id=${order.id}`,
    `square_payment_id=${charge.paymentId}`
  );

  // The customer paid, so they see what they paid for. The row stays
  // unconfirmed until someone fixes it, which is the state the shop can act on.
  return { ...order, ...paid };
}

/**
 * Answers a request the customer has already made.
 *
 * Reached only through the unique index: an order carrying this id exists,
 * so the question is not whether to create another one but what to tell the
 * browser that never heard back the first time.
 */
async function respondToRepeatedAttempt(clientRequestId: string) {
  const [existing] = await db
    .select({ order: orders, event_date: eventDates, event: events })
    .from(orders)
    .innerJoin(eventDates, eq(eventDates.id, orders.event_date_id))
    .innerJoin(events, eq(events.id, orders.event_id))
    .where(eq(orders.client_request_id, clientRequestId))
    .limit(1);

  if (!existing) {
    // Cancelled out from under us between the insert and this read.
    return NextResponse.json(
      { error: "もう一度お試しください。" },
      { status: 409 }
    );
  }

  const { order, event, event_date } = existing;

  if (order.order_status === "cancelled") {
    return NextResponse.json(
      { error: "このご注文は取り消されています。もう一度お試しください。" },
      { status: 409 }
    );
  }

  if (order.payment_status === "pending") {
    // The first request is still in flight, or it died mid-charge. Either
    // way, sending the card through again is the one thing not to do.
    return NextResponse.json(
      {
        error:
          "ご注文を処理中です。しばらく待っても完了画面が出ない場合は、二重にお支払いにならないよう、お店までお問い合わせください。",
      },
      { status: 409 }
    );
  }

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.order_id, order.id));

  return NextResponse.json(
    {
      ...order,
      items,
      event_date,
      pickup_location: event.pickup_location,
      contact_phone: event.contact_phone,
    },
    { status: 200 }
  );
}
