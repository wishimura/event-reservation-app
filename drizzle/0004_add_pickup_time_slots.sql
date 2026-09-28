ALTER TABLE "events" ADD COLUMN "pickup_time_slots" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_time_slot" text;