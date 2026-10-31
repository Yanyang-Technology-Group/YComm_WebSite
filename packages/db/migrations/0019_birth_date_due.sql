ALTER TABLE "users" ADD COLUMN "birth_date_due_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "users_birth_date_due_idx" ON "users" USING btree ("birth_date_due_at") WHERE "birth_date" IS NULL;
