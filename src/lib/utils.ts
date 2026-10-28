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
export function defaultReservationCloseAt(
  pickupDate: string,
  now: Date = new Date()
): Date {
  const [year, month, day] = pickupDate.split("-").map(Number);
  const dayBefore = new Date(Date.UTC(year, month - 1, day - 1));
  const iso = dayBefore.toISOString().slice(0, 10);
  const evening = new Date(`${iso}T23:59:59+09:00`);

  /*
    前日の夜がもう過ぎていて、当日の夜はまだ来ていないなら、その日の終わりまで
    受け付けます。要するに「今日」を足したときです。

    これが無いと、当日の受取日を足した瞬間に「受付締切済み」になります。足した
    本人に締切のつもりは無いので、作ったそばから閉じている理由が分かりません
    （テストのために今日を1日足すときに、必ずここを踏みます）。

    過ぎた日を足した場合は前日のままにします。閉じているのが正しいからです。
  */
  const dayEnd = new Date(`${pickupDate}T23:59:59+09:00`);
  if (evening.getTime() <= now.getTime() && dayEnd.getTime() > now.getTime()) {
    return dayEnd;
  }
  return evening;
}

/**
 * 日本時間の「YYYY-MM-DDTHH:mm」。`<input type="datetime-local">` に入れる形。
 *
 * 端末の時計がどこの国に合っていても、画面に出るのは日本時間です。店舗は日本に
 * ありますが、端末の設定は端末のものなので、こちら側で揃えます。
 */
export function toJstInputValue(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 16);
}

/**
 * `<input type="datetime-local">` の値を、日本時間として読む。
 *
 * 読めない文字列には null を返します。呼ぶ側で弾いてください。
 */
export function fromJstInputValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:59+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
