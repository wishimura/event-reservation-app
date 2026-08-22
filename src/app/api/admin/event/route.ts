import { NextRequest, NextResponse } from "next/server";
import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { eventDates, events, orders } from "@/db/schema";
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

    // leftJoin, so a date with no orders still appears in the list.
    const dateRows = await db
      .select({ date: eventDates, order_count: count(orders.id) })
      .from(eventDates)
      .leftJoin(orders, eq(orders.event_date_id, eventDates.id))
      .where(eq(eventDates.event_id, event.id))
      .groupBy(eventDates.id)
      .orderBy(asc(eventDates.pickup_date));

    return NextResponse.json({
      event,
      dates: dateRows.map((r) => ({ ...r.date, order_count: r.order_count })),
    });
  } catch (error) {
    console.error("Event settings load error:", error);
    return NextResponse.json(
      { error: "イベント情報の取得に失敗しました" },
      { status: 500 }
    );
  }
}

interface EventPatchBody {
  name: string;
  description: string;
  start_date: string;
  end_date: string;
  pickup_location: string;
  contact_phone: string;
  reservation_note: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(request: NextRequest) {
  let body: EventPatchBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json(
      { error: "イベント名を入力してください" },
      { status: 400 }
    );
  }
  if (!DATE_RE.test(body.start_date) || !DATE_RE.test(body.end_date)) {
    return NextResponse.json(
      { error: "開催期間の日付が不正です" },
      { status: 400 }
    );
  }
  if (body.start_date > body.end_date) {
    return NextResponse.json(
      { error: "開催期間の終了日が開始日より前になっています" },
      { status: 400 }
    );
  }

  try {
    const event = await getActiveEvent();
    if (!event) {
      return NextResponse.json(
        { error: "現在開催中のイベントはありません" },
        { status: 404 }
      );
    }

    const [updated] = await db
      .update(events)
      .set({
        name: body.name.trim(),
        description: body.description ?? "",
        start_date: body.start_date,
        end_date: body.end_date,
        pickup_location: body.pickup_location ?? "",
        contact_phone: (body.contact_phone ?? "").trim(),
        reservation_note: body.reservation_note ?? "",
      })
      .where(eq(events.id, event.id))
      .returning();

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Event settings save error:", error);
    return NextResponse.json(
      { error: "イベント情報の保存に失敗しました" },
      { status: 500 }
    );
  }
}
