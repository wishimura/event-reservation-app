import { NextRequest, NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { dailyProductInventory, products } from "@/db/schema";
import { refreshDateReservationStatus, resolveSoldOut } from "@/lib/inventory";
import { getActiveEvent, getAllEventDates } from "@/lib/queries";
import { isUuid, readJsonObject } from "@/lib/http";

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
  const parsed = await readJsonObject(request);
  if (!parsed) {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }
  let items = parsed.items as InventoryPatchItem[];

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "更新対象がありません" }, { status: 400 });
  }

  for (const item of items) {
    if (
      !isUuid(item.id) ||
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

  /**
   * Always in the same order, whoever is saving.
   *
   * A customer's order locks the day's stock rows sorted by id. If this save
   * took them in the order the form happened to send, the two could each
   * hold a row the other wants, and Postgres would break the tie by killing
   * one of them — the customer's, as likely as the shop's.
   */
  items = [...items].sort((a, b) => a.id.localeCompare(b.id));

  try {
    const updated = await db.transaction(async (tx) => {
      // Reject caps that would fall below what is already reserved, with a
      // message naming the products — the CHECK constraint alone can't say that.
      //
      // Locked while we look: without it an order placed in the moment
      // between reading and writing would leave the row reserved beyond its
      // new cap, and the CHECK would abort the save with nothing to say.
      const existing = await tx
        .select({ inventory: dailyProductInventory, product: products })
        .from(dailyProductInventory)
        .innerJoin(products, eq(products.id, dailyProductInventory.product_id))
        .where(
          inArray(
            dailyProductInventory.id,
            items.map((i) => i.id)
          )
        )
        .for("update", { of: dailyProductInventory });

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
        const current = byId.get(item.id)!.inventory;

        await tx
          .update(dailyProductInventory)
          .set({
            production_quantity: item.production_quantity,
            is_sold_out: resolveSoldOut(item, current),
            is_hidden: item.is_hidden,
          })
          .where(eq(dailyProductInventory.id, item.id));
      }

      /**
       * Raising a cap is how the operator reopens a day that sold out, so the
       * day's status has to be recomputed here. Without this the date stays
       * closed however much stock is added, and nothing on either screen says
       * why customers cannot book it.
       */
      const affectedDates = new Set(
        items.map((i) => byId.get(i.id)!.inventory.event_date_id)
      );
      for (const eventDateId of affectedDates) {
        await refreshDateReservationStatus(tx, eventDateId);
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
