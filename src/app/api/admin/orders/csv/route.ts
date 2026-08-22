import { NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { eventDates, orderItems, orders } from "@/db/schema";
import { getActiveEvent } from "@/lib/queries";
import { todayInJST } from "@/lib/utils";

export const dynamic = "force-dynamic";

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatDateJP(dateStr: string): string {
  return dateStr.replace(/-/g, "/");
}

function formatDateTimeJP(value: Date): string {
  return value.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

const paymentStatusMap: Record<string, string> = {
  pending: "未決済",
  paid: "決済済み",
  failed: "失敗",
  refunded: "返金済み",
};

const orderStatusMap: Record<string, string> = {
  temporary: "仮予約",
  confirmed: "確定",
  cancelled: "キャンセル",
};

const pickupStatusMap: Record<string, string> = {
  not_picked_up: "未受取",
  picked_up: "受取済",
};

export async function GET() {
  try {
    const event = await getActiveEvent();
    if (!event) {
      return NextResponse.json(
        { error: "イベントが見つかりません" },
        { status: 404 }
      );
    }

    // Sorted by pickup date, then by when the order came in.
    const orderRows = await db
      .select({ order: orders, event_date: eventDates })
      .from(orders)
      .innerJoin(eventDates, eq(eventDates.id, orders.event_date_id))
      .where(eq(orders.event_id, event.id))
      .orderBy(asc(eventDates.pickup_date), asc(orders.created_at));

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

    const itemsByOrder = new Map<string, typeof itemRows>();
    for (const item of itemRows) {
      const list = itemsByOrder.get(item.order_id) ?? [];
      list.push(item);
      itemsByOrder.set(item.order_id, list);
    }

    const headers = [
      "受取日",
      "注文番号",
      "注文日時",
      "お客様名",
      "メールアドレス",
      "電話番号",
      "商品名",
      "単価",
      "数量",
      "小計",
      "注文合計",
      "支払方法",
      "決済ステータス",
      "注文ステータス",
      "受取ステータス",
    ];

    const rows: string[] = [headers.join(",")];

    for (const { order, event_date } of orderRows) {
      const base = [
        escapeCSV(formatDateJP(event_date.pickup_date)),
        escapeCSV(order.order_number),
        escapeCSV(formatDateTimeJP(order.created_at)),
        escapeCSV(order.customer_name),
        escapeCSV(order.customer_email),
        escapeCSV(order.customer_phone),
      ];

      const tail = [
        String(order.total_amount),
        escapeCSV(order.payment_method === "cash" ? "現地払い" : "クレジットカード"),
        escapeCSV(paymentStatusMap[order.payment_status] ?? order.payment_status),
        escapeCSV(orderStatusMap[order.order_status] ?? order.order_status),
        escapeCSV(pickupStatusMap[order.pickup_status] ?? order.pickup_status),
      ];

      const items = itemsByOrder.get(order.id) ?? [];

      if (items.length === 0) {
        rows.push([...base, "", "", "", "", ...tail].join(","));
      } else {
        for (const item of items) {
          rows.push(
            [
              ...base,
              escapeCSV(item.product_name_snapshot),
              String(item.unit_price),
              String(item.quantity),
              String(item.subtotal),
              ...tail,
            ].join(",")
          );
        }
      }
    }

    // UTF-8 BOM so Excel opens it without mangling Japanese.
    const csv = "\uFEFF" + rows.join("\n");
    const filename = `orders_${todayInJST().replace(/-/g, "")}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("CSV export error:", error);
    return NextResponse.json(
      { error: "CSVエクスポートに失敗しました" },
      { status: 500 }
    );
  }
}
