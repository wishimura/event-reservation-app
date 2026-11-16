import { sql } from "drizzle-orm";
import { db } from "@/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 「残りわずか」に切り替わる、その日の残り割合。
 *
 * 2026-11-16 の実データで決めました。この日までの6日ぶんで、
 * 残り46%・37%の日はお店の感覚で「まだ受付中」、残り13%・11%の日は
 * 「残りわずか」。その境目が20%のあたりでした。
 *
 * 10%まで下げると残り11%の日が漏れ、30%まで上げると3割以上残っている日
 * まで煽ることになります。
 */
export const FEW_LEFT_RATIO = 0.2;

/**
 * Recomputes whether a pickup date is still taking reservations.
 *
 * `event_dates.reservation_status` is a cached summary of the day's stock, and
 * the customer's date list is built from it alone. Anything that changes the
 * stock has to call this, or the cache and the stock drift apart — and the
 * drift that matters is a date left closed with room on it, which no customer
 * can book and no screen explains.
 *
 * Hidden rows are left out: the operator took them off sale deliberately, so
 * they should not be able to close the day on their own. Counter-only
 * products are left out for the same reason — they are never bookable, so
 * counting them would close every date the moment one existed.
 *
 * ## 判定は、その日全体の残り割合で
 *
 * 以前は「1商品でも残り3個以下なら残りわずか」でした。これが実体と逆に
 * 動きます。**売り切れた商品（残り0）はその数え上げから外れる**ので、
 * 売れれば売れるほど「残りわずか」の条件から外れ、全部売り切れて初めて
 * 閉じる、という作りでした。
 *
 * 現に 2026-11-21 は10商品中8つが売り切れ、残りは1割強でしたが「受付中」。
 * 一方 11/19 は46%も残っているのに、脇役1品が少ないだけで「残りわずか」。
 * 6日のうち4日が逆でした。
 *
 * いまは**その日の残り合計 ÷ 生産数合計**で決めます。売れるほど残りに
 * 近づく、という当たり前の動きになります。
 *
 * One statement rather than a read and a write. This runs inside the order
 * transaction, while the day's stock rows are locked, and every round trip
 * to the database is a round trip the next customer in the queue waits for.
 */
export async function refreshDateReservationStatus(
  tx: Transaction,
  eventDateId: string
): Promise<void> {
  await tx.execute(sql`
    WITH stock AS (
      SELECT
        /*
          お店が手で「売切」にした商品は、数が残っていても残り0として数える。
          売らないと決めたぶんが残りに混ざると、実際には買えない数を
          「まだあります」と言うことになる。
        */
        CASE
          WHEN i.is_sold_out OR i.reserved_quantity >= i.production_quantity
          THEN 0
          ELSE i.production_quantity - i.reserved_quantity
        END AS remaining,
        i.production_quantity AS capacity
      FROM daily_product_inventory i
      JOIN products p ON p.id = i.product_id
      WHERE i.event_date_id = ${eventDateId}
        AND i.is_hidden = false
        AND p.walk_in_only = false
    ),
    verdict AS (
      SELECT
        count(*) AS rows_seen,
        sum(remaining) AS remaining,
        sum(capacity) AS capacity
      FROM stock
    )
    UPDATE event_dates
    SET reservation_status = CASE
      WHEN (SELECT remaining FROM verdict) <= 0 THEN 'closed'
      WHEN (SELECT remaining FROM verdict)::numeric
             <= (SELECT capacity FROM verdict)::numeric * ${FEW_LEFT_RATIO}
        THEN 'few_left'
      ELSE 'open'
    END::reservation_status
    WHERE id = ${eventDateId}
      AND (SELECT rows_seen FROM verdict) > 0
  `);
}

/**
 * Whether a row ends up sold out.
 *
 * The badge is the operator's to set — they may want to stop selling
 * something that still has room. But it is also flipped automatically when
 * the last one goes, and then raising the cap left a row reading "2 left"
 * and "SOLD OUT" at the same time, still unbookable.
 *
 * So: at or over capacity is always sold out. Below capacity clears the flag
 * only when the operator did not set it themselves in this save, and the row
 * was full before — that is the automatic flag, and the cap they just raised
 * says they want to sell again.
 */
export function resolveSoldOut(
  item: { production_quantity: number; is_sold_out: boolean },
  current: { production_quantity: number; reserved_quantity: number; is_sold_out: boolean }
): boolean {
  if (item.production_quantity <= current.reserved_quantity) return true;

  const operatorChangedIt = item.is_sold_out !== current.is_sold_out;
  const wasAutomatic =
    current.is_sold_out &&
    current.reserved_quantity >= current.production_quantity;

  if (!operatorChangedIt && wasAutomatic) return false;

  return item.is_sold_out;
}
