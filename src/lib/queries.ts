import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { eventDates, events, products } from "@/db/schema";

/** The app is built around a single active event at a time. */
export async function getActiveEvent() {
  const [event] = await db
    .select()
    .from(events)
    .where(eq(events.is_active, true))
    .orderBy(asc(events.created_at))
    .limit(1);

  return event ?? null;
}

/**
 * The event and its dates, in one trip.
 *
 * This is the front page, so it is the query every customer makes before
 * they make any other. The database is in Singapore and the site is in
 * Tokyo; asking twice in a row cost a visible fraction of a second for
 * nothing, since the second question never depended on the answer to the
 * first beyond `is_active`.
 */
export async function getActiveEventWithDates() {
  const rows = await db
    .select({ event: events, event_date: eventDates })
    .from(events)
    .leftJoin(
      eventDates,
      and(eq(eventDates.event_id, events.id), eq(eventDates.is_active, true))
    )
    .where(eq(events.is_active, true))
    .orderBy(asc(events.created_at), asc(eventDates.pickup_date));

  if (rows.length === 0) return null;

  // More than one active event would be a mistake, but if it ever happened
  // the front page should still show the same one `getActiveEvent` picks.
  const event = rows[0].event;
  const dates = rows
    .filter((r) => r.event_date !== null && r.event.id === event.id)
    .map((r) => r.event_date!);

  return { ...event, event_dates: dates };
}

/** All dates for an event, including inactive ones (admin views need those). */
export async function getAllEventDates(eventId: string) {
  return db
    .select()
    .from(eventDates)
    .where(eq(eventDates.event_id, eventId))
    .orderBy(asc(eventDates.pickup_date));
}

/**
 * トップに並べる料理の写真。
 *
 * 写真のある商品だけを、並び順で返します。無いものは出しません——丸い穴が
 * 空いているより、そこだけ詰まっているほうが見られます。
 *
 * 価格も一緒に返します。トップで値段が分かると、受取日を選ぶ前に
 * 「いくらくらいか」の見当がつきます。
 */
export async function getEventShowcase(eventId: string) {
  return db
    .select({
      id: products.id,
      name: products.name,
      price: products.price,
      image_url: products.image_url,
    })
    .from(products)
    .where(
      and(
        eq(products.event_id, eventId),
        eq(products.is_active, true),
        isNotNull(products.image_url)
      )
    )
    .orderBy(asc(products.sort_order), asc(products.name));
}
