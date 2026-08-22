import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
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
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    paid_at: timestamp("paid_at", { withTimezone: true }),
  },
  (t) => [
    index("orders_event_id_idx").on(t.event_id),
    index("orders_event_date_id_idx").on(t.event_date_id),
    index("orders_created_at_idx").on(t.created_at),
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
