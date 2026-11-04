import { NextRequest, NextResponse } from "next/server";
import {
  DEVICE_COOKIE,
  findSavedCard,
  forgetSavedCard,
  toSavedCardView,
} from "@/lib/saved-card";
import { disableStoredCard } from "@/lib/square";

/**
 * この端末が覚えているカード。
 *
 * ## 読むと忘れるだけ
 *
 * 覚えるのはここではありません。ご注文の処理（`/api/orders`）が、決済が
 * 済んだあとに決済 id から覚えます。書き込みの窓口を外に開けずに済むので、
 * そのほうが安全でもあります。
 *
 * どちらも **Cookie の持ち主だけ** が自分の1枚に触れます。本文でカードを
 * 名指しすることはできません。そうでないと、id を当てた人が他人のカードで
 * 決済できてしまいます。
 */

export const dynamic = "force-dynamic";

function deviceToken(request: NextRequest): string | undefined {
  return request.cookies.get(DEVICE_COOKIE)?.value;
}

/** この端末の1枚を返す。無ければ null。 */
export async function GET(request: NextRequest) {
  const row = await findSavedCard(deviceToken(request));
  return NextResponse.json({ card: row ? toSavedCardView(row) : null });
}

/** 「このカードを忘れる」。Square 側でも止める。 */
export async function DELETE(request: NextRequest) {
  const token = deviceToken(request);
  if (!token) return NextResponse.json({ ok: true });

  const row = await findSavedCard(token);
  if (!row) return NextResponse.json({ ok: true });

  try {
    await forgetSavedCard(token);
  } catch (error) {
    console.error("Failed to forget a saved card:", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  await disableStoredCard(row.square_card_id);
  return NextResponse.json({ ok: true });
}
