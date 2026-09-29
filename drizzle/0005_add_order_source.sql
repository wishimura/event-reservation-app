CREATE TYPE "public"."order_source" AS ENUM('online', 'walk_in');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "source" "order_source" DEFAULT 'online' NOT NULL;