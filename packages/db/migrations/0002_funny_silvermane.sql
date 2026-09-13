CREATE TYPE "public"."download_card_kind" AS ENUM('container', 'redirect', 'resources');--> statement-breakpoint
CREATE TABLE "download_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"title" varchar(80) NOT NULL,
	"subtitle" varchar(200) DEFAULT '' NOT NULL,
	"kind" "download_card_kind" DEFAULT 'container' NOT NULL,
	"redirect_url" text,
	"w" integer DEFAULT 1 NOT NULL,
	"h" integer DEFAULT 1 NOT NULL,
	"visibility" text DEFAULT 'public' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "download_cards" ADD CONSTRAINT "download_cards_parent_id_download_cards_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."download_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "download_cards_parent_idx" ON "download_cards" USING btree ("parent_id");