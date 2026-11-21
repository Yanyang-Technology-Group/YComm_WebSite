CREATE TABLE "download_card_tickets" (
	"token_hash" varchar(64) PRIMARY KEY NOT NULL,
	"card_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "download_cards" ADD COLUMN "one_time_link_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "download_card_tickets" ADD CONSTRAINT "download_card_tickets_card_id_download_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."download_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "download_card_tickets_expiry_idx" ON "download_card_tickets" USING btree ("expires_at");
