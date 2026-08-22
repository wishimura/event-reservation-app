ALTER TABLE "orders" ALTER COLUMN "pickup_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "pickup_status" SET DEFAULT 'not_picked_up'::text;--> statement-breakpoint
DROP TYPE "public"."pickup_status";--> statement-breakpoint
CREATE TYPE "public"."pickup_status" AS ENUM('not_picked_up', 'picked_up');--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "pickup_status" SET DEFAULT 'not_picked_up'::"public"."pickup_status";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "pickup_status" SET DATA TYPE "public"."pickup_status" USING "pickup_status"::"public"."pickup_status";