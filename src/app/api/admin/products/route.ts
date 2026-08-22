import { NextRequest, NextResponse } from "next/server";
import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { dailyProductInventory, eventDates, orderItems, products } from "@/db/schema";
import { getActiveEvent } from "@/lib/queries";

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

    // leftJoin so a product with no orders yet still shows up.
    const rows = await db
      .select({ product: products, order_count: count(orderItems.id) })
      .from(products)
      .leftJoin(orderItems, eq(orderItems.product_id, products.id))
      .where(eq(products.event_id, event.id))
      .groupBy(products.id)
      .orderBy(asc(products.sort_order));

    return NextResponse.json({
      event,
      products: rows.map((r) => ({ ...r.product, order_count: r.order_count })),
    });
  } catch (error) {
    console.error("Products load error:", error);
    return NextResponse.json(
      { error: "商品情報の取得に失敗しました" },
      { status: 500 }
    );
  }
}

interface ProductBody {
  name: string;
  description?: string;
  price: number;
  sort_order?: number;
  default_capacity?: number;
}

function validateProduct(body: ProductBody): string | null {
  if (typeof body.name !== "string" || !body.name.trim()) {
    return "商品名を入力してください";
  }
  if (!Number.isInteger(body.price) || body.price < 0) {
    return "価格は0以上の整数で入力してください";
  }
  return null;
}

/**
 * Creates a product and gives it an inventory row on every pickup date.
 * Without the backfill the product would exist but never appear for sale.
 */
export async function POST(request: NextRequest) {
  let body: ProductBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const invalid = validateProduct(body);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  const capacity = Number.isInteger(body.default_capacity)
    ? Math.max(0, body.default_capacity as number)
    : 0;

  try {
    const event = await getActiveEvent();
    if (!event) {
      return NextResponse.json(
        { error: "現在開催中のイベントはありません" },
        { status: 404 }
      );
    }

    const created = await db.transaction(async (tx) => {
      const [product] = await tx
        .insert(products)
        .values({
          event_id: event.id,
          name: body.name.trim(),
          description: body.description ?? "",
          price: body.price,
          sort_order: Number.isInteger(body.sort_order)
            ? (body.sort_order as number)
            : 0,
        })
        .returning();

      const dates = await tx
        .select()
        .from(eventDates)
        .where(eq(eventDates.event_id, event.id));

      if (dates.length > 0) {
        await tx.insert(dailyProductInventory).values(
          dates.map((d) => ({
            event_date_id: d.id,
            product_id: product.id,
            production_quantity: capacity,
          }))
        );
      }

      return { product, inventory_rows: dates.length };
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("Product create error:", error);
    return NextResponse.json(
      { error: "商品の追加に失敗しました" },
      { status: 500 }
    );
  }
}
