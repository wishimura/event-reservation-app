import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { eventDates, orderItems, orders, products } from "@/db/schema";
import { getActiveEvent } from "@/lib/queries";
import { todayInJST } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * 受取管理が見ている1日ぶん。
 *
 * `?date=YYYY-MM-DD` で日を選べます。渡されなければ今日です。
 *
 * 先の日も読めるようにしてあるのは、**仕込みの前に、その日の受け渡しが
 * どうなるかを見ておきたい**からです。何人の方が何件ずつ取りに来るのかは、
 * 当日の朝に初めて知るより、前の日に知っておくほうが段取りが立ちます。
 * 書き換え（受取完了）を止めるのは画面側の仕事で、ここは読むだけです。
 *
 * 選べる日の一覧も一緒に返します。画面がもう一度問い合わせずに済みます。
 */
export async function GET(request: NextRequest) {
  try {
    const event = await getActiveEvent();
    if (!event) {
      return NextResponse.json(
        { error: "現在開催中のイベントはありません" },
        { status: 404 }
      );
    }

    const today = todayInJST();

    // この催しの日付しか見られない。形だけ合う文字列で他所を覗けないように。
    const dates = await db
      .select()
      .from(eventDates)
      .where(eq(eventDates.event_id, event.id))
      .orderBy(asc(eventDates.pickup_date));

    const requested = request.nextUrl.searchParams.get("date");
    const selected =
      requested && dates.some((d) => d.pickup_date === requested)
        ? requested
        : today;

    const todayDate = dates.find((d) => d.pickup_date === selected);

    if (!todayDate) {
      return NextResponse.json({
        event,
        today,
        selected_date: selected,
        dates,
        event_date: null,
        orders: [],
      });
    }

    const orderRows = await db
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.event_date_id, todayDate.id),
          eq(orders.order_status, "confirmed")
        )
      )
      .orderBy(asc(orders.customer_name));

    const itemRows = orderRows.length
      ? await db
          .select({ item: orderItems, product: products })
          .from(orderItems)
          .innerJoin(products, eq(products.id, orderItems.product_id))
          .where(
            inArray(
              orderItems.order_id,
              orderRows.map((o) => o.id)
            )
          )
      : [];

    const itemsByOrder = new Map<string, unknown[]>();
    for (const row of itemRows) {
      const list = itemsByOrder.get(row.item.order_id) ?? [];
      list.push({ ...row.item, product: row.product });
      itemsByOrder.set(row.item.order_id, list);
    }

    return NextResponse.json({
      event,
      today,
      selected_date: selected,
      dates,
      event_date: todayDate,
      orders: orderRows.map((o) => ({
        ...o,
        order_items: itemsByOrder.get(o.id) ?? [],
      })),
    });
  } catch (error) {
    console.error("Pickup load error:", error);
    return NextResponse.json(
      { error: "受取情報の取得に失敗しました" },
      { status: 500 }
    );
  }
}
