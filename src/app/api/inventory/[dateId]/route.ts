import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dateId: string }> }
) {
  try {
    const { dateId } = await params;

    if (!dateId) {
      return NextResponse.json(
        { error: "日付IDが指定されていません" },
        { status: 400 }
      );
    }

    const { data: inventory, error } = await supabaseAdmin
      .from("daily_product_inventory")
      .select("*, product:products(*)")
      .eq("event_date_id", dateId)
      .eq("is_hidden", false);

    if (error) {
      console.error("Inventory fetch error:", error);
      return NextResponse.json(
        { error: "在庫情報の取得に失敗しました" },
        { status: 500 }
      );
    }

    return NextResponse.json(inventory ?? []);
  } catch (error) {
    console.error("Inventory fetch error:", error);
    return NextResponse.json(
      { error: "在庫情報の取得中にエラーが発生しました" },
      { status: 500 }
    );
  }
}
