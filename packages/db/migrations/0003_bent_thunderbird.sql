ALTER TYPE "public"."user_state" ADD VALUE 'deleting' BEFORE 'deleted';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;