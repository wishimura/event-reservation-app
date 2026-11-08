import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { eventDates, events, orderItems, orders } from "@/db/schema";
import { isUuid } from "@/lib/http";
import { resendCustomerEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

/**
 * 確認メールを、お客様にもう一度送る。
 *
 * 配信事業者の1日の上限に当たると、予約は通るのに確認メールだけが出ません。
 * お客様には何も届かず、こちらには「メール未送信」とだけ残ります。
 * 電話で1件ずつ注文番号をお伝えするしかなかったところを、押せば済むように
 * します。
 *
 * ## 送る中身は、いま保存されているもの
 *
 * 注文を取り直すのではなく、保存済みの内容からもう一度組み立てます。
 * 受取日や金額があとから変わっていれば、**変わったあとの内容**が届きます。
 * 最初に送ったはずのものを復元する作りにはしていません。お客様に必要なのは
 * 「いまどうなっているか」であって、当時の控えではないからです。
 *
 * ## 店頭販売には使えません
 *
 * メールアドレスを持たない注文があり、宛先がありません。
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "注文が見つかりません" }, { status: 404 });
    }

    const [row] = await db
      .select({ order: orders, event_date: eventDates, event: events })
      .from(orders)
      .innerJoin(eventDates, eq(eventDates.id, orders.event_date_id))
      .innerJoin(events, eq(events.id, orders.event_id))
      .where(eq(orders.id, id));

    if (!row) {
      return NextResponse.json({ error: "注文が見つかりません" }, { status: 404 });
    }

    if (row.order.order_status === "cancelled") {
      return NextResponse.json(
        { error: "キャンセル済みの注文には送れません" },
        { status: 400 }
      );
    }

    const to = row.order.customer_email?.trim();
    if (!to) {
      return NextResponse.json(
        { error: "この注文にはメールアドレスがありません" },
        { status: 400 }
      );
    }

    const items = await db
      .select({
        product_name_snapshot: orderItems.product_name_snapshot,
        unit_price: orderItems.unit_price,
        quantity: orderItems.quantity,
        subtotal: orderItems.subtotal,
      })
      .from(orderItems)
      .where(eq(orderItems.order_id, id));

    const result = await resendCustomerEmail({
      order_number: row.order.order_number,
      customer_name: row.order.customer_name,
      customer_email: to,
      customer_phone: row.order.customer_phone,
      total_amount: row.order.total_amount,
      pickup_date: row.event_date.pickup_date,
      dining_style: row.order.dining_style,
      payment_method: row.order.payment_method,
      payment_status: row.order.payment_status,
      event_name: row.event.name,
      pickup_location: row.event.pickup_location,
      reservation_note: row.event.reservation_note,
      contact_phone: row.event.contact_phone,
      items,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: 502 });
    }

    return NextResponse.json({ ok: true, message: result.message, to });
  } catch (error) {
    console.error("Resend mail error:", error);
    return NextResponse.json(
      { error: "確認メールの再送に失敗しました" },
      { status: 500 }
    );
  }
}
