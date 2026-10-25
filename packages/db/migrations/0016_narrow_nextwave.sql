ALTER TABLE "users" ADD COLUMN "terms_version" varchar(32);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "birth_date" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "guardian_email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "guardian_consent_at" timestamp with time zone;