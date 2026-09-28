import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dailyProductInventory, eventDates } from "@/db/schema";

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
 */
export async function refreshDateReservationStatus(
  tx: Transaction,
  eventDateId: string
): Promise<void> {
  const inventory = await tx
    .select()
    .from(dailyProductInventory)
    .where(
      and(
        eq(dailyProductInventory.event_date_id, eventDateId),
        eq(dailyProductInventory.is_hidden, false)
      )
    );

  // Nothing to judge by — leave whatever the operator set.
  if (inventory.length === 0) return;

  const allSoldOut = inventory.every((i) => i.is_sold_out);
  const anyNearThreshold = inventory.some((i) => {
    const remaining = i.production_quantity - i.reserved_quantity;
    return remaining > 0 && remaining <= i.warning_threshold;
  });

  await tx
    .update(eventDates)
    .set({
      reservation_status: allSoldOut
        ? "closed"
        : anyNearThreshold
          ? "few_left"
          : "open",
    })
    .where(eq(eventDates.id, eventDateId));
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
