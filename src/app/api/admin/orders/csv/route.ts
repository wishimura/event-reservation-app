import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function escapeCSV(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatDateJP(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00+09:00");
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateTimeJP(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
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
  absent: "未来店",
};

export async function GET() {
  try {
    // Get the active event
    const { data: ev } = await supabaseAdmin
      .from("events")
      .select("*")
      .eq("is_active", true)
      .single();

    if (!ev) {
      return NextResponse.json({ error: "イベントが見つかりません" }, { status: 404 });
    }

    // Fetch all orders with items and event_date, sorted by pickup_date then created_at
    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select("*, event_date:event_dates(*), order_items(*, product:products(*))")
      .eq("event_id", ev.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("CSV export error:", error);
      return NextResponse.json({ error: "注文データの取得に失敗しました" }, { status: 500 });
    }

    // Sort by pickup_date first, then created_at
    const sorted = (orders || []).sort((a, b) => {
      const dateA = a.event_date?.pickup_date || "";
      const dateB = b.event_date?.pickup_date || "";
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return (a.created_at || "").localeCompare(b.created_at || "");
    });

    // Build CSV rows - one row per order item for spreadsheet usability
    const BOM = "\uFEFF"; // UTF-8 BOM for Excel
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

    for (const order of sorted) {
      const pickupDate = order.event_date
        ? formatDateJP(order.event_date.pickup_date)
        : "";
      const createdAt = order.created_at
        ? formatDateTimeJP(order.created_at)
        : "";
      const paymentMethod = order.payment_method === "cash" ? "現金" : "クレジットカード";
      const paymentStatus = paymentStatusMap[order.payment_status] || order.payment_status;
      const orderStatus = orderStatusMap[order.order_status] || order.order_status;
      const pickupStatus = pickupStatusMap[order.pickup_status] || order.pickup_status;

      const items = order.order_items || [];

      if (items.length === 0) {
        // Order with no items (edge case)
        rows.push(
          [
            escapeCSV(pickupDate),
            escapeCSV(order.order_number),
            escapeCSV(createdAt),
            escapeCSV(order.customer_name),
            escapeCSV(order.customer_email),
            escapeCSV(order.customer_phone),
            "",
            "",
            "",
            "",
            String(order.total_amount),
            escapeCSV(paymentMethod),
            escapeCSV(paymentStatus),
            escapeCSV(orderStatus),
            escapeCSV(pickupStatus),
          ].join(",")
        );
      } else {
        for (const item of items) {
          rows.push(
            [
              escapeCSV(pickupDate),
              escapeCSV(order.order_number),
              escapeCSV(createdAt),
              escapeCSV(order.customer_name),
              escapeCSV(order.customer_email),
              escapeCSV(order.customer_phone),
              escapeCSV(item.product_name_snapshot || ""),
              String(item.unit_price),
              String(item.quantity),
              String(item.subtotal),
              String(order.total_amount),
              escapeCSV(paymentMethod),
              escapeCSV(paymentStatus),
              escapeCSV(orderStatus),
              escapeCSV(pickupStatus),
            ].join(",")
          );
        }
      }
    }

    const csv = BOM + rows.join("\n");

    // Generate filename with current date
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const filename = `orders_${dateStr}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("CSV export error:", error);
    return NextResponse.json({ error: "CSVエクスポートに失敗しました" }, { status: 500 });
  }
}
