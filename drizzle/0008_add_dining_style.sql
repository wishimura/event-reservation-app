CREATE TYPE "dining_style" AS ENUM('eat_in', 'takeout');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "dining_style" "dining_style" DEFAULT 'takeout' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "dining_style_changed_at" timestamp with time zone;
