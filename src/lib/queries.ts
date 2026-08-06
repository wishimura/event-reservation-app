import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { eventDates, events } from "@/db/schema";

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

export async function getActiveEventWithDates() {
  const event = await getActiveEvent();
  if (!event) return null;

  const dates = await db
    .select()
    .from(eventDates)
    .where(
      and(eq(eventDates.event_id, event.id), eq(eventDates.is_active, true))
    )
    .orderBy(asc(eventDates.pickup_date));

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
