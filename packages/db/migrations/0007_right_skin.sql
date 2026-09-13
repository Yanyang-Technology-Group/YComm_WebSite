ALTER TABLE "users" ADD COLUMN "following_visibility" varchar(16) DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "followers_visibility" varchar(16) DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "homepage_visibility" varchar(16) DEFAULT 'public' NOT NULL;