import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Column names are kept in snake_case on the TypeScript side as well so that
 * rows serialize straight to the shapes the UI already expects (see
 * src/lib/types.ts). This keeps the DB swap from rippling into every component.
 */

export const reservationStatusEnum = pgEnum("reservation_status", [
  "open",
  "few_left",
  "closed",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "paid",
  "failed",
  "refunded",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "credit_card",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "temporary",
  "confirmed",
  "cancelled",
]);

export const pickupStatusEnum = pgEnum("pickup_status", [
  "not_picked_up",
  "picked_up",
]);

/**
 * Where an order came from.
 *
 * The shop also sells over the counter to people who never used the site, and
 * those sales have to come out of the same day's stock or the production plan
 * lies. Recording which is which keeps the two tellable apart afterwards.
 */
export const orderSourceEnum = pgEnum("order_source", ["online", "walk_in"]);

/**
 * 店内で食べるか、持ち帰るか。
 *
 * 売値はどちらも同じなので、お客様から見た金額は変わりません。変わるのは
 * 消費税率で、持ち帰りは軽減税率8%、店内飲食は10%です。同じ840円でも
 * お店が納める税額が違うため、どちらだったかを必ず残します。
 *
 * 税率が決まるのは「提供した時点」の意思なので、当日カウンターで変わった
 * ときは、その場で直したものが正になります。
 */
export const diningStyleEnum = pgEnum("dining_style", ["eat_in", "takeout"]);

/**
 * Product photos uploaded from the console.
 *
 * Kept in their own table rather than on `products`, because every product
 * query selects the whole row — a picture living there would be dragged into
 * the customer's product list on every page load.
 *
 * Stored as base64 text rather than bytea: a handful of photos at a few
 * hundred kilobytes each costs nothing at this size, and text behaves the
 * same whichever Postgres driver is in use.
 */
export const productImages = pgTable("product_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  content_type: text("content_type").notNull(),
  byte_size: integer("byte_size").notNull(),
  data_base64: text("data_base64").notNull(),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  start_date: date("start_date").notNull(),
  end_date: date("end_date").notNull(),
  pickup_location: text("pickup_location").notNull().default(""),
  reservation_note: text("reservation_note").notNull().default(""),
  /** Shown to customers as the line to call for changes or cancellations. */
  contact_phone: text("contact_phone").notNull().default(""),
  is_active: boolean("is_active").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    price: integer("price").notNull(),
    image_url: text("image_url"),
    sort_order: integer("sort_order").notNull().default(0),
    is_active: boolean("is_active").notNull().default(true),
  },
  (t) => [
    index("products_event_id_idx").on(t.event_id),
    check("products_price_non_negative", sql`${t.price} >= 0`),
  ]
);

export const eventDates = pgTable(
  "event_dates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    pickup_date: date("pickup_date").notNull(),
    reservation_open: boolean("reservation_open").notNull().default(true),
    reservation_status: reservationStatusEnum("reservation_status")
      .notNull()
      .default("open"),
    reservation_close_at: timestamp("reservation_close_at", {
      withTimezone: true,
    }),
    is_active: boolean("is_active").notNull().default(true),
  },
  (t) => [
    unique("event_dates_event_id_pickup_date_key").on(t.event_id, t.pickup_date),
    index("event_dates_pickup_date_idx").on(t.pickup_date),
  ]
);

export const dailyProductInventory = pgTable(
  "daily_product_inventory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    event_date_id: uuid("event_date_id")
      .notNull()
      .references(() => eventDates.id, { onDelete: "cascade" }),
    product_id: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    production_quantity: integer("production_quantity").notNull().default(0),
    reserved_quantity: integer("reserved_quantity").notNull().default(0),
    is_sold_out: boolean("is_sold_out").notNull().default(false),
    is_hidden: boolean("is_hidden").notNull().default(false),
    warning_threshold: integer("warning_threshold").notNull().default(3),
  },
  (t) => [
    unique("daily_product_inventory_date_product_key").on(
      t.event_date_id,
      t.product_id
    ),
    index("daily_product_inventory_event_date_id_idx").on(t.event_date_id),
    /**
     * Last line of defence against overbooking: even if application logic is
     * wrong, the database refuses to reserve past the cap.
     */
    check(
      "daily_product_inventory_reserved_within_capacity",
      sql`${t.reserved_quantity} >= 0 AND ${t.reserved_quantity} <= ${t.production_quantity}`
    ),
  ]
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    order_number: text("order_number").notNull().unique(),
    event_id: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "restrict" }),
    event_date_id: uuid("event_date_id")
      .notNull()
      .references(() => eventDates.id, { onDelete: "restrict" }),
    customer_name: text("customer_name").notNull(),
    customer_email: text("customer_email").notNull(),
    customer_phone: text("customer_phone").notNull(),
    total_amount: integer("total_amount").notNull(),
    payment_status: paymentStatusEnum("payment_status")
      .notNull()
      .default("pending"),
    payment_method: paymentMethodEnum("payment_method")
      .notNull()
      .default("cash"),
    order_status: orderStatusEnum("order_status").notNull().default("temporary"),
    pickup_status: pickupStatusEnum("pickup_status")
      .notNull()
      .default("not_picked_up"),
    source: orderSourceEnum("source").notNull().default("online"),
    /**
     * 既定が持ち帰りなのは、この列が足される前の注文がすべて持ち帰り前提
     * だったからです。新しい注文では、お客様に必ず選んでいただきます。
     */
    dining_style: diningStyleEnum("dining_style").notNull().default("takeout"),
    /**
     * 当日カウンターで切り替えられたときの時刻。
     *
     * 入っていれば「ご予約時の選択から変わった」ということで、税額の根拠を
     * あとから説明するときに効きます。ご予約どおりなら null のままです。
     */
    dining_style_changed_at: timestamp("dining_style_changed_at", {
      withTimezone: true,
    }),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    paid_at: timestamp("paid_at", { withTimezone: true }),
    /**
     * Square's own identifiers for the charge. Refunds are issued by hand in
     * the Square dashboard, so the console has to be able to point the
     * operator at the exact payment.
     */
    square_payment_id: text("square_payment_id"),
    square_receipt_url: text("square_receipt_url"),
    /**
     * The browser's own id for one attempt to place this order.
     *
     * A phone that loses signal in the second the card is charged shows the
     * customer an error for an order that in fact went through, and tapping
     * again would charge them twice. The browser therefore labels the
     * attempt, and a second request wearing the same label is recognised as
     * the same order rather than made into a new one.
     *
     * Null for counter sales, and for the reservations taken before this
     * existed.
     */
    client_request_id: text("client_request_id"),
  },
  (t) => [
    index("orders_event_id_idx").on(t.event_id),
    index("orders_event_date_id_idx").on(t.event_date_id),
    index("orders_created_at_idx").on(t.created_at),
    unique("orders_client_request_id_key").on(t.client_request_id),
  ]
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    order_id: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    product_id: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    product_name_snapshot: text("product_name_snapshot").notNull(),
    unit_price: integer("unit_price").notNull(),
    quantity: integer("quantity").notNull(),
    subtotal: integer("subtotal").notNull(),
  },
  (t) => [
    index("order_items_order_id_idx").on(t.order_id),
    check("order_items_quantity_positive", sql`${t.quantity} > 0`),
  ]
);

/* ----------------------------- relations ----------------------------- */

export const eventsRelations = relations(events, ({ many }) => ({
  products: many(products),
  event_dates: many(eventDates),
  orders: many(orders),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  event: one(events, {
    fields: [products.event_id],
    references: [events.id],
  }),
  inventory: many(dailyProductInventory),
}));

export const eventDatesRelations = relations(eventDates, ({ one, many }) => ({
  event: one(events, {
    fields: [eventDates.event_id],
    references: [events.id],
  }),
  inventory: many(dailyProductInventory),
  orders: many(orders),
}));

export const dailyProductInventoryRelations = relations(
  dailyProductInventory,
  ({ one }) => ({
    event_date: one(eventDates, {
      fields: [dailyProductInventory.event_date_id],
      references: [eventDates.id],
    }),
    product: one(products, {
      fields: [dailyProductInventory.product_id],
      references: [products.id],
    }),
  })
);

export const ordersRelations = relations(orders, ({ one, many }) => ({
  event: one(events, {
    fields: [orders.event_id],
    references: [events.id],
  }),
  event_date: one(eventDates, {
    fields: [orders.event_date_id],
    references: [eventDates.id],
  }),
  order_items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.order_id],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.product_id],
    references: [products.id],
  }),
}));


/**
 * 調べるための記録。
 *
 * ## なぜ要るか
 *
 * 2026-10-30 に「2回目の決済ができなかった」というお申し出がありました。調べて
 * みると、注文も、失敗して取り消された注文も、1件も残っていませんでした。
 * 失敗はブラウザの中で起きていて、サーバーには何も届いていませんでした。
 * Vercel の実行ログも1時間ほどで消えます。
 *
 * つまり**何が起きたのか確かめる手段が無かった**。そのための表です。
 *
 * 決済だけでなく、確認メールの送信、画面の例外、サーバーの想定外の失敗も
 * ここに集めます。**画面で分かる不具合は困らない。困るのは中で起きたこと**
 * なので、中で起きたことを1か所に残します。
 *
 * ## 書かないもの
 *
 * カード番号も、Square のトークンも、ここには入れません。入れてよいのは
 * 「どこで」「どう転んだか」と、突き合わせに要る最小限（注文番号・金額・
 * 連絡先）だけです。
 *
 * ## 種別（area）
 *
 * - `payment` 決済にたどり着くまでと、決済そのもの
 * - `email`   確認メール・店舗通知の送信
 * - `screen`  お客様の画面で起きた例外
 * - `data`    画面が必要なデータを取れなかった
 * - `server`  サーバーの想定外の失敗
 */
export const incidentLogs = pgTable(
  "incident_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** payment / email / screen / data / server。 */
    area: text("area").notNull().default("payment"),
    /** "server" か "browser"。ブラウザ発はお客様の端末からの申告。 */
    source: text("source").notNull(),
    /**
     * どこで転んだか。種別ごとに意味が決まります（`src/lib/incident-log.ts`）。
     *
     * 列挙型ではなく文字列です。記録を1つ増やすたびにデータベースの型を
     * 変えなければならないのでは、残すべきものを残さなくなります。
     */
    stage: text("stage").notNull(),
    /** ok / declined / error / abandoned。 */
    outcome: text("outcome").notNull(),
    order_number: text("order_number"),
    amount: integer("amount"),
    customer_email: text("customer_email"),
    /** 画面に出した文言か、こちらで掴んだ理由。 */
    message: text("message").notNull().default(""),
    /** Square のエラーコードなど。カード情報は入れない。 */
    detail: jsonb("detail"),
    /** どの画面・どの経路で起きたか。 */
    path: text("path"),
    user_agent: text("user_agent"),
  },
  (t) => [
    index("incident_logs_created_at_idx").on(t.created_at),
    index("incident_logs_area_idx").on(t.area),
  ]
);
