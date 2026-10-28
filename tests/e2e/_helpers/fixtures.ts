/**
 * E2E の前提データ。
 *
 * **毎回ゼロから作り直します。** 前のテストの副作用に頼ると、実行順を変えた
 * だけで、あるいは `-g` で一部だけ流しただけで壊れます。
 *
 * 日付は今日から数えます。固定の日付を書くと、その日を過ぎた時点で
 * 「受付中の受取日が1つも無い」という、テストとは無関係な理由で全部落ちます。
 * 受取管理の画面は今日のぶんしか映さないので、今日を必ず1日入れます。
 */
import { e2eDb, truncateAll } from "./db";

/** `YYYY-MM-DD`、n 日後。日本時間で数える。 */
export function dayFromToday(n: number): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  jst.setUTCDate(jst.getUTCDate() + n);
  return jst.toISOString().slice(0, 10);
}

/** 画面で探すときに使う、決め打ちの名前。 */
export const FIXTURE = {
  eventName: "E2E 検証イベント",
  /** 普通に買える商品。数に余裕がある。 */
  plenty: { name: "E2E ドリップバッグ", price: 800, capacity: 10 },
  /** 残り1個しか作らない商品。上限で止まることを確かめる。 */
  scarce: { name: "E2E カヌレ", price: 1200, capacity: 1 },
  /** 売り切れにしてある商品。 */
  soldOut: { name: "E2E スコーン", price: 500, capacity: 10 },
} as const;

export interface Fixture {
  eventId: string;
  /** 今日。受取管理が映すのはこの日だけ。 */
  today: { id: string; date: string };
  /** 明日。締切や並びの確認に使う。 */
  tomorrow: { id: string; date: string };
  /** 受付を止めてある日。お客様の一覧に出ないこと。 */
  closed: { id: string; date: string };
  products: { plenty: string; scarce: string; soldOut: string };
}

/**
 * データベースを空にして、前提データを入れ直す。
 *
 * 返り値の id は、URL を直接叩くテスト（受付停止の日を直打ちする、など）で使います。
 */
export async function resetFixture(): Promise<Fixture> {
  await truncateAll();
  const db = e2eDb();

  const today = dayFromToday(0);
  const tomorrow = dayFromToday(1);
  const closed = dayFromToday(2);

  const event = await db.query<{ id: string }>(
    `insert into events
       (name, description, start_date, end_date, pickup_location, contact_phone,
        reservation_note, is_active)
     values ($1, $2, $3, $4, $5, $6, $7, true)
     returning id`,
    [
      FIXTURE.eventName,
      "E2E のための催しです。",
      today,
      closed,
      "となりのと 本店（1F カウンター）",
      "070-6669-1010",
      /*
        本番のご案内文には「受取時間は各日 11:00〜16:00 です」と書かれています。
        お店が入れた文章であって、時間枠を選ばせる画面ではありません。前提データにも
        同じ言い回しを入れておかないと、「この語が無いこと」を見るだけのテストが
        書けてしまい、本番では素通りします。
      */
      "受取時間は各日 11:00〜16:00 です。\nお支払いはご予約時にお願いいたします。",
    ]
  );
  const eventId = event.rows[0].id;

  const product = async (name: string, price: number, sort: number) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into products (event_id, name, description, price, sort_order)
       values ($1, $2, '', $3, $4) returning id`,
      [eventId, name, price, sort]
    );
    return rows[0].id;
  };

  const products = {
    plenty: await product(FIXTURE.plenty.name, FIXTURE.plenty.price, 1),
    scarce: await product(FIXTURE.scarce.name, FIXTURE.scarce.price, 2),
    soldOut: await product(FIXTURE.soldOut.name, FIXTURE.soldOut.price, 3),
  };

  const eventDate = async (date: string, open: boolean) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into event_dates (event_id, pickup_date, reservation_open, reservation_status)
       values ($1, $2, $3, $4) returning id`,
      [eventId, date, open, open ? "open" : "closed"]
    );
    return rows[0].id;
  };

  const dates = {
    today: { id: await eventDate(today, true), date: today },
    tomorrow: { id: await eventDate(tomorrow, true), date: tomorrow },
    closed: { id: await eventDate(closed, false), date: closed },
  };

  for (const d of Object.values(dates)) {
    for (const [key, id] of Object.entries(products)) {
      const spec = FIXTURE[key as keyof typeof products];
      await db.query(
        `insert into daily_product_inventory
           (event_date_id, product_id, production_quantity, reserved_quantity,
            is_sold_out, warning_threshold)
         values ($1, $2, $3, 0, $4, 3)`,
        [d.id, id, spec.capacity, key === "soldOut"]
      );
    }
  }

  return { eventId, ...dates, products };
}
