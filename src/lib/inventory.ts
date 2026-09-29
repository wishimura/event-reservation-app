import { sql } from "drizzle-orm";
import { db } from "@/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
 * they should not be able to close the day on their own.
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
        production_quantity - reserved_quantity AS remaining,
        warning_threshold,
        is_sold_out OR reserved_quantity >= production_quantity AS sold_out
      FROM daily_product_inventory
      WHERE event_date_id = ${eventDateId} AND is_hidden = false
    ),
    verdict AS (
      SELECT
        count(*) AS rows_seen,
        bool_and(sold_out) AS all_sold_out,
        bool_or(remaining > 0 AND remaining <= warning_threshold) AS any_low
      FROM stock
    )
    UPDATE event_dates
    SET reservation_status = CASE
      WHEN (SELECT all_sold_out FROM verdict) THEN 'closed'
      WHEN (SELECT any_low FROM verdict) THEN 'few_left'
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
