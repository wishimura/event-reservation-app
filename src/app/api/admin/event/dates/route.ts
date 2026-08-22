import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dailyProductInventory, eventDates, products } from "@/db/schema";
import { getActiveEvent } from "@/lib/queries";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
}

/**
 * Adds a pickup date.
 *
 * Every (date × product) pair needs an inventory row or the product simply
 * will not appear on that day, so the new date is backfilled for all active
 * products in the same transaction.
 */
export async function POST(request: NextRequest) {
  let body: { pickup_date: string; default_capacity?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  if (!DATE_RE.test(body.pickup_date ?? "")) {
    return NextResponse.json(
      { error: "日付を YYYY-MM-DD の形式で指定してください" },
      { status: 400 }
    );
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
      const [date] = await tx
        .insert(eventDates)
        .values({ event_id: event.id, pickup_date: body.pickup_date })
        .returning();

      const activeProducts = await tx
        .select()
        .from(products)
        .where(
          and(eq(products.event_id, event.id), eq(products.is_active, true))
        );

      if (activeProducts.length > 0) {
        await tx.insert(dailyProductInventory).values(
          activeProducts.map((p) => ({
            event_date_id: date.id,
            product_id: p.id,
            production_quantity: capacity,
          }))
        );
      }

      return { date, inventory_rows: activeProducts.length };
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "その受取日はすでに登録されています" },
        { status: 409 }
      );
    }
    console.error("Event date create error:", error);
    return NextResponse.json(
      { error: "受取日の追加に失敗しました" },
      { status: 500 }
    );
  }
}
