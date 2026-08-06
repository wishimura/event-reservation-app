import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { dailyProductInventory, eventDates, products } from "@/db/schema";
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

    const dates = await db
      .select()
      .from(eventDates)
      .where(
        and(eq(eventDates.event_id, event.id), eq(eventDates.is_active, true))
      )
      .orderBy(asc(eventDates.pickup_date));

    const inventory = dates.length
      ? (
          await db
            .select({ inventory: dailyProductInventory, product: products })
            .from(dailyProductInventory)
            .innerJoin(
              products,
              eq(products.id, dailyProductInventory.product_id)
            )
            .where(
              inArray(
                dailyProductInventory.event_date_id,
                dates.map((d) => d.id)
              )
            )
            .orderBy(asc(products.sort_order))
        ).map((r) => ({ ...r.inventory, product: r.product }))
      : [];

    return NextResponse.json({ event, dates, inventory });
  } catch (error) {
    console.error("Production load error:", error);
    return NextResponse.json(
      { error: "製造計画の取得に失敗しました" },
      { status: 500 }
    );
  }
}
