import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const { data: event, error } = await supabaseAdmin
      .from("events")
      .select("*, event_dates:event_dates(*)")
      .eq("is_active", true)
      .order("pickup_date", { referencedTable: "event_dates", ascending: true })
      .limit(1)
      .single();

    if (error) {
      console.error("Event fetch error:", error);
      return NextResponse.json(
        { error: "イベントの取得に失敗しました" },
        { status: 500 }
      );
    }

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
