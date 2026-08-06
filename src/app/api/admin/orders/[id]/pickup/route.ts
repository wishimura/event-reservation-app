import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";

export const dynamic = "force-dynamic";

const ALLOWED = ["not_picked_up", "picked_up", "absent"] as const;
type PickupStatus = (typeof ALLOWED)[number];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    let pickup_status: unknown;
    try {
      ({ pickup_status } = await request.json());
    } catch {
      return NextResponse.json(
        { error: "リクエストが不正です" },
        { status: 400 }
      );
    }

    if (!ALLOWED.includes(pickup_status as PickupStatus)) {
      return NextResponse.json(
        { error: "受取ステータスが不正です" },
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(orders)
      .set({ pickup_status: pickup_status as PickupStatus })
      .where(eq(orders.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { error: "注文が見つかりません" },
        { status: 404 }
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Pickup update error:", error);
    return NextResponse.json(
      { error: "受取ステータスの更新に失敗しました" },
      { status: 500 }
    );
  }
}
