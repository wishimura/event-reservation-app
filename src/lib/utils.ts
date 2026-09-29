export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  return `${d.getMonth() + 1}/${d.getDate()}(${days[d.getDay()]})`;
}

/**
 * "Today" for this app always means today in Japan, not in the server's or
 * browser's timezone. `en-CA` formats as YYYY-MM-DD, matching our date columns.
 */
export function todayInJST(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

export function formatPrice(price: number): string {
  return `¥${price.toLocaleString()}`;
}

export function generateOrderNumber(): string {
  // The date part is JST, like every other date the shop sees. Built from
  // the server's own clock it read as the previous day for anything ordered
  // before 9am, since the server runs on UTC.
  const ts = todayInJST().slice(2).replace(/-/g, "");

  // Six characters rather than four. Collisions are retried, but a retry
  // replays the whole transaction — stock included — so they are worth
  // making rare: 36^6 is about two billion.
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "0");

  return `ORD-${ts}-${rand}`;
}

export function getRemainingQuantity(inv: { production_quantity: number; reserved_quantity: number }) {
  return Math.max(0, inv.production_quantity - inv.reserved_quantity);
}

export function getStatusLabel(status: string): { label: string; color: string } {
  switch (status) {
    case "open":
      return { label: "受付中", color: "bg-brand-100 text-brand-700" };
    case "few_left":
      return { label: "残りわずか", color: "bg-amber-100 text-amber-800" };
    case "closed":
      return { label: "受付終了", color: "bg-zinc-200 text-zinc-500" };
    default:
      return { label: status, color: "bg-zinc-100 text-zinc-600" };
  }
}

/**
 * The pickup times a customer may choose from.
 *
 * Stored as free text, one per line, so the shop can word them however it
 * likes. Blank lines and stray spaces are the normal result of typing into a
 * textarea, and duplicates would render as two identical choices, so all
 * three are dropped here rather than in each screen.
 */
export function parsePickupTimeSlots(raw: string | null | undefined): string[] {
  if (!raw) return [];

  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    const slot = line.trim();
    if (slot) seen.add(slot);
  }
  return [...seen];
}

/**
 * Whether a pickup date has passed its reservation deadline.
 *
 * Everything here is made to order, so the shop needs the numbers before it
 * starts prepping. `reservation_close_at` is the moment the day stops taking
 * bookings; a date without one stays open until its stock runs out.
 *
 * Judged against the real clock rather than a stored flag, so nothing has to
 * run on a schedule to close a date on time.
 */
export function isPastReservationDeadline(
  closeAt: string | Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (!closeAt) return false;

  const deadline = closeAt instanceof Date ? closeAt : new Date(closeAt);
  if (Number.isNaN(deadline.getTime())) return false;

  return now.getTime() > deadline.getTime();
}

/**
 * The status a customer should see, which is the stored one unless the
 * deadline has passed.
 */
export function effectiveReservationStatus(
  date: {
    reservation_status: "open" | "few_left" | "closed";
    reservation_close_at: string | Date | null;
  },
  now: Date = new Date()
): "open" | "few_left" | "closed" {
  return isPastReservationDeadline(date.reservation_close_at, now)
    ? "closed"
    : date.reservation_status;
}

/**
 * The default deadline for a pickup date: 23:59 the evening before, JST.
 *
 * Everything is made to order, so the kitchen needs the day's numbers settled
 * before it starts. Written as a +09:00 offset rather than built from local
 * parts, so the server's own timezone never moves it.
 */
export function defaultReservationCloseAt(pickupDate: string): Date {
  const [year, month, day] = pickupDate.split("-").map(Number);
  const dayBefore = new Date(Date.UTC(year, month - 1, day - 1));
  const iso = dayBefore.toISOString().slice(0, 10);

  return new Date(`${iso}T23:59:59+09:00`);
}
