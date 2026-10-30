ALTER TABLE "mail_body_templates" ADD COLUMN "subject" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_body_templates" ADD COLUMN "subtitle" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_body_templates" ADD COLUMN "background" text DEFAULT 'community' NOT NULL;--> statement-breakpoint
UPDATE "mail_body_templates" SET "subject" = "name";
