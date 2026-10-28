import { NextRequest, NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { eventDates, orders } from "@/db/schema";
import { isUuid, readJsonObject } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Changes one pickup date: whether it is offered, and when it stops taking
 * bookings.
 *
 * The deadline used to be settable only by hand in the database, which meant
 * the shop could not try the site outside its own opening hours and could not
 * extend a day that needed a little longer. Both fields are optional; send
 * only the one being changed.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "受取日が見つかりません" }, { status: 404 });
    }

    const body = await readJsonObject(request);
    if (!body) {
      return NextResponse.json(
        { error: "リクエストが不正です" },
        { status: 400 }
      );
    }

    const changes: { is_active?: boolean; reservation_close_at?: Date | null } = {};

    if ("is_active" in body) {
      if (typeof body.is_active !== "boolean") {
        return NextResponse.json({ error: "値が不正です" }, { status: 400 });
      }
      changes.is_active = body.is_active;
    }

    if ("reservation_close_at" in body) {
      const value = body.reservation_close_at;
      if (value === null || value === "") {
        // 締切なし。在庫が尽きるまで開いたままになります。
        changes.reservation_close_at = null;
      } else if (typeof value === "string") {
        const at = new Date(value);
        if (Number.isNaN(at.getTime())) {
          return NextResponse.json(
            { error: "締切の日時が読み取れません" },
            { status: 400 }
          );
        }
        changes.reservation_close_at = at;
      } else {
        return NextResponse.json(
          { error: "締切の日時が読み取れません" },
          { status: 400 }
        );
      }
    }

    if (Object.keys(changes).length === 0) {
      return NextResponse.json(
        { error: "変更する項目がありません" },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(eventDates)
      .set(changes)
      .where(eq(eventDates.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "受取日が見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Event date update error:", error);
    return NextResponse.json(
      { error: "受取日の更新に失敗しました" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!isUuid(id)) {
      return NextResponse.json({ error: "受取日が見つかりません" }, { status: 404 });
    }

    // Orders reference the date with ON DELETE restrict, so check first and
    // explain rather than letting a foreign key error surface as a 500.
    const [{ value: orderCount }] = await db
      .select({ value: count() })
      .from(orders)
      .where(eq(orders.event_date_id, id));

    if (orderCount > 0) {
      return NextResponse.json(
        {
          error: `この受取日にはすでに ${orderCount} 件の予約があるため削除できません。受付を止めたい場合は「受付停止」にしてください。`,
        },
        { status: 409 }
      );
    }

    // Inventory rows cascade with the date.
    const [deleted] = await db
      .delete(eventDates)
      .where(eq(eventDates.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { error: "受取日が見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Event date delete error:", error);
    return NextResponse.json(
      { error: "受取日の削除に失敗しました" },
      { status: 500 }
    );
  }
}
