CREATE TABLE IF NOT EXISTS "saved_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_token_hash" text NOT NULL,
	"square_customer_id" text NOT NULL,
	"square_card_id" text NOT NULL,
	"card_brand" text DEFAULT '' NOT NULL,
	"last4" text DEFAULT '' NOT NULL,
	"exp_month" integer,
	"exp_year" integer,
	"customer_name" text DEFAULT '' NOT NULL,
	"customer_email" text DEFAULT '' NOT NULL,
	"customer_phone" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "saved_cards_device_token_hash_key" UNIQUE("device_token_hash")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "extra_image_urls" text[] DEFAULT '{}'::text[] NOT NULL;
