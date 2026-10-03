ALTER TYPE "public"."content_status" ADD VALUE 'scheduled' BEFORE 'deleted';--> statement-breakpoint
CREATE TABLE "topic_views" (
	"topic_id" uuid NOT NULL,
	"visitor_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_views" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_comments" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_likes" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_shares" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_official" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "topic_views" ADD CONSTRAINT "topic_views_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "topic_views_topic_visitor_unique" ON "topic_views" USING btree ("topic_id","visitor_key");