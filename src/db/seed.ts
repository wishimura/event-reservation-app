import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * `src/db/index.ts` reads DATABASE_URL at import time, so it has to be pulled
 * in *after* dotenv has populated the environment.
 */
async function main() {
  const { db } = await import("./index");
  const { events, products, eventDates, dailyProductInventory, orders, orderItems } =
    await import("./schema");

  console.log("Clearing existing data...");
  // Order matters: children first.
  await db.delete(orderItems);
  await db.delete(orders);
  await db.delete(dailyProductInventory);
  await db.delete(eventDates);
  await db.delete(products);
  await db.delete(events);

  console.log("Inserting event...");
  const [event] = await db
    .insert(events)
    .values({
      name: "秋の焙煎まつり",
      description:
        "自家焙煎のコーヒーと、その日の朝に焼き上げる菓子をお持ち帰りいただけます。すべて受注生産のため、事前のご予約をお願いしています。",
      start_date: "2026-10-10",
      end_date: "2026-10-13",
      pickup_location: "となりのと 本店（1F カウンター）",
      contact_phone: "070-6669-1010",
      reservation_note:
        "受取時間は各日 11:00〜18:00 です。\nお支払いは店頭でのお会計となります。\n受取日の変更は前日までにご連絡ください。",
      is_active: true,
    })
    .returning();

  console.log("Inserting products...");
  const productRows = await db
    .insert(products)
    .values([
      {
        event_id: event.id,
        name: "季節のドリップバッグ 5個セット",
        description: "エチオピア・グアテマラなど、秋向けの浅煎りを詰め合わせ。",
        price: 1800,
        sort_order: 1,
      },
      {
        event_id: event.id,
        name: "カヌレ（4個入り）",
        description: "外はカリッと、中はもっちり。当日焼き上げ。",
        price: 1400,
        sort_order: 2,
      },
      {
        event_id: event.id,
        name: "スコーン 2種（プレーン／チョコ）",
        description: "北海道産バターを使用。温め直してどうぞ。",
        price: 900,
        sort_order: 3,
      },
      {
        event_id: event.id,
        name: "コーヒーゼリー（3個入り）",
        description: "深煎りを濃いめに抽出した、ほろ苦い大人向け。",
        price: 1200,
        sort_order: 4,
      },
      {
        event_id: event.id,
        name: "焙煎豆 200g（お好みの焙煎度で）",
        description: "受取時に浅煎り／中煎り／深煎りをお選びいただけます。",
        price: 2200,
        sort_order: 5,
      },
    ])
    .returning();

  console.log("Inserting event dates...");
  const dateRows = await db
    .insert(eventDates)
    .values([
      { event_id: event.id, pickup_date: "2026-10-10" },
      { event_id: event.id, pickup_date: "2026-10-11" },
      { event_id: event.id, pickup_date: "2026-10-12" },
      { event_id: event.id, pickup_date: "2026-10-13" },
    ])
    .returning();

  console.log("Inserting daily inventory...");
  // Made-to-order model: production_quantity is the per-day intake cap.
  const capacityBySortOrder: Record<number, number> = {
    1: 30,
    2: 20,
    3: 24,
    4: 18,
    5: 25,
  };

  await db.insert(dailyProductInventory).values(
    dateRows.flatMap((d) =>
      productRows.map((p) => ({
        event_date_id: d.id,
        product_id: p.id,
        production_quantity: capacityBySortOrder[p.sort_order] ?? 20,
        reserved_quantity: 0,
        warning_threshold: 3,
      }))
    )
  );

  console.log(
    `Done. event=${event.id}, ${productRows.length} products, ${dateRows.length} dates, ${
      dateRows.length * productRows.length
    } inventory rows.`
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
