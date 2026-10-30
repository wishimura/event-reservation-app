import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { paymentLogs } from "@/db/schema";

export const dynamic = "force-dynamic";

/** 画面が一度に読む上限。古いものを延々と引かない。 */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 300;

/**
 * 決済まわりの記録を新しい順に返す。
 *
 * お申し出があったときに「その時刻に何が起きていたか」を引くための窓口です。
 */
export async function GET(request: NextRequest) {
  try {
    const asked = Number(request.nextUrl.searchParams.get("limit"));
    const limit =
      Number.isInteger(asked) && asked > 0
        ? Math.min(asked, MAX_LIMIT)
        : DEFAULT_LIMIT;

    const logs = await db
      .select()
      .from(paymentLogs)
      .orderBy(desc(paymentLogs.created_at))
      .limit(limit);

    return NextResponse.json({ logs });
  } catch (error) {
    console.error("Payment log load error:", error);
    return NextResponse.json(
      { error: "決済ログの取得に失敗しました" },
      { status: 500 }
    );
  }
}
