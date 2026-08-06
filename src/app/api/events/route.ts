import { NextResponse } from "next/server";
import { getActiveEventWithDates } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const event = await getActiveEventWithDates();

    if (!event) {
      return NextResponse.json(
        { error: "現在開催中のイベントはありません" },
        { status: 404 }
      );
    }

    return NextResponse.json(event);
  } catch (error) {
    console.error("Event fetch error:", error);
    return NextResponse.json(
      { error: "イベントの取得中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
