CREATE TYPE "public"."order_status" AS ENUM('temporary', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'credit_card');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'paid', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."pickup_status" AS ENUM('not_picked_up', 'picked_up', 'absent');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('open', 'few_left', 'closed');--> statement-breakpoint
CREATE TABLE "daily_product_inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_date_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"production_quantity" integer DEFAULT 0 NOT NULL,
	"reserved_quantity" integer DEFAULT 0 NOT NULL,
	"is_sold_out" boolean DEFAULT false NOT NULL,
	"is_hidden" boolean DEFAULT false NOT NULL,
	"warning_threshold" integer DEFAULT 3 NOT NULL,
	CONSTRAINT "daily_product_inventory_date_product_key" UNIQUE("event_date_id","product_id"),
	CONSTRAINT "daily_product_inventory_reserved_within_capacity" CHECK ("daily_product_inventory"."reserved_quantity" >= 0 AND "daily_product_inventory"."reserved_quantity" <= "daily_product_inventory"."production_quantity")
);
--> statement-breakpoint
CREATE TABLE "event_dates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"pickup_date" date NOT NULL,
	"reservation_open" boolean DEFAULT true NOT NULL,
	"reservation_status" "reservation_status" DEFAULT 'open' NOT NULL,
	"reservation_close_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "event_dates_event_id_pickup_date_key" UNIQUE("event_id","pickup_date")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"pickup_location" text DEFAULT '' NOT NULL,
	"reservation_note" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"product_name_snapshot" text NOT NULL,
	"unit_price" integer NOT NULL,
	"quantity" integer NOT NULL,
	"subtotal" integer NOT NULL,
	CONSTRAINT "order_items_quantity_positive" CHECK ("order_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"event_id" uuid NOT NULL,
	"event_date_id" uuid NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text NOT NULL,
	"total_amount" integer NOT NULL,
	"payment_status" "payment_status" DEFAULT 'pending' NOT NULL,
	"payment_method" "payment_method" DEFAULT 'cash' NOT NULL,
	"order_status" "order_status" DEFAULT 'temporary' NOT NULL,
	"pickup_status" "pickup_status" DEFAULT 'not_picked_up' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "orders_order_number_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" integer NOT NULL,
	"image_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "products_price_non_negative" CHECK ("products"."price" >= 0)
);
--> statement-breakpoint
ALTER TABLE "daily_product_inventory" ADD CONSTRAINT "daily_product_inventory_event_date_id_event_dates_id_fk" FOREIGN KEY ("event_date_id") REFERENCES "public"."event_dates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_product_inventory" ADD CONSTRAINT "daily_product_inventory_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_dates" ADD CONSTRAINT "event_dates_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_date_id_event_dates_id_fk" FOREIGN KEY ("event_date_id") REFERENCES "public"."event_dates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "daily_product_inventory_event_date_id_idx" ON "daily_product_inventory" USING btree ("event_date_id");--> statement-breakpoint
CREATE INDEX "event_dates_pickup_date_idx" ON "event_dates" USING btree ("pickup_date");--> statement-breakpoint
CREATE INDEX "order_items_order_id_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_event_id_idx" ON "orders" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "orders_event_date_id_idx" ON "orders" USING btree ("event_date_id");--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "products_event_id_idx" ON "products" USING btree ("event_id");