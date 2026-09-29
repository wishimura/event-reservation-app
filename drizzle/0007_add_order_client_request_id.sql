ALTER TABLE "orders" ADD COLUMN "client_request_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_client_request_id_key" UNIQUE("client_request_id");
