import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { dailyProductInventory, products } from "@/db/schema";
import { getActiveEvent, getAllEventDates } from "@/lib/queries";

export const dynamic = "force-dynamic";

class InventoryConflictError extends Error {
  conflicts: string[];
  constructor(conflicts: string[]) {
    super("inventory conflict");
    this.name = "InventoryConflictError";
    this.conflicts = conflicts;
  }
}

export async function GET(request: NextRequest) {
  try {
    const event = await getActiveEvent();
    if (!event) {
      return NextResponse.json(
        { error: "現在開催中のイベントはありません" },
        { status: 404 }
      );
    }

    const dates = await getAllEventDates(event.id);
    const dateId = request.nextUrl.searchParams.get("dateId");

    const inventory = dateId
      ? (
          await db
            .select({ inventory: dailyProductInventory, product: products })
            .from(dailyProductInventory)
            .innerJoin(
              products,
              eq(products.id, dailyProductInventory.product_id)
            )
            .where(eq(dailyProductInventory.event_date_id, dateId))
            .orderBy(asc(products.sort_order))
        ).map((r) => ({ ...r.inventory, product: r.product }))
      : [];

    return NextResponse.json({ event, dates, inventory });
  } catch (error) {
    console.error("Inventory load error:", error);
    return NextResponse.json(
      { error: "在庫情報の取得に失敗しました" },
      { status: 500 }
    );
  }
}

interface InventoryPatchItem {
  id: string;
  production_quantity: number;
  is_sold_out: boolean;
  is_hidden: boolean;
}

export async function PATCH(request: NextRequest) {
  let items: InventoryPatchItem[];
  try {
    ({ items } = await request.json());
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "更新対象がありません" }, { status: 400 });
  }

  for (const item of items) {
    if (
      !item.id ||
      !Number.isInteger(item.production_quantity) ||
      item.production_quantity < 0 ||
      typeof item.is_sold_out !== "boolean" ||
      typeof item.is_hidden !== "boolean"
    ) {
      return NextResponse.json(
        { error: "在庫データの形式が不正です" },
        { status: 400 }
      );
    }
  }

  try {
    const updated = await db.transaction(async (tx) => {
      // Reject caps that would fall below what is already reserved, with a
      // message naming the products — the CHECK constraint alone can't say that.
      const existing = await tx
        .select({ inventory: dailyProductInventory, product: products })
        .from(dailyProductInventory)
        .innerJoin(products, eq(products.id, dailyProductInventory.product_id))
        .where(
          inArray(
            dailyProductInventory.id,
            items.map((i) => i.id)
          )
        );

      const byId = new Map(existing.map((r) => [r.inventory.id, r]));
      const conflicts: string[] = [];

      for (const item of items) {
        const row = byId.get(item.id);
        if (!row) {
          conflicts.push("対象の在庫データが見つかりません");
          continue;
        }
        if (item.production_quantity < row.inventory.reserved_quantity) {
          conflicts.push(
            `「${row.product.name}」は既に${row.inventory.reserved_quantity}個の予約があるため、受付上限を${item.production_quantity}に下げられません`
          );
        }
      }

      if (conflicts.length > 0) {
        throw new InventoryConflictError(conflicts);
      }

      for (const item of items) {
        await tx
          .update(dailyProductInventory)
          .set({
            production_quantity: item.production_quantity,
            is_sold_out: item.is_sold_out,
            is_hidden: item.is_hidden,
          })
          .where(eq(dailyProductInventory.id, item.id));
      }

      return items.length;
    });

    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    if (error instanceof InventoryConflictError) {
      return NextResponse.json(
        { error: "保存できない項目があります", details: error.conflicts },
        { status: 409 }
      );
    }
    console.error("Inventory save error:", error);
    return NextResponse.json(
      { error: "在庫の保存に失敗しました" },
      { status: 500 }
    );
  }
}
