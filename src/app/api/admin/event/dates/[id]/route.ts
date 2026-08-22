import { NextRequest, NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { eventDates, orders } from "@/db/schema";

export const dynamic = "force-dynamic";

/** Toggles whether the date is offered to customers. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    let is_active: unknown;
    try {
      ({ is_active } = await request.json());
    } catch {
      return NextResponse.json(
        { error: "リクエストが不正です" },
        { status: 400 }
      );
    }

    if (typeof is_active !== "boolean") {
      return NextResponse.json({ error: "値が不正です" }, { status: 400 });
    }

    const [updated] = await db
      .update(eventDates)
      .set({ is_active })
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
