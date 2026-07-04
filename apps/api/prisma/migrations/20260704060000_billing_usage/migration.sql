-- Merchant billing fields
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "subscription_id" TEXT;
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "subscription_status" TEXT;
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMP(3);
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "current_period_start" TIMESTAMP(3);
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "current_period_end" TIMESTAMP(3);
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "grace_period_ends_at" TIMESTAMP(3);
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3);
ALTER TABLE "merchants" ADD COLUMN IF NOT EXISTS "usage_line_item_id" TEXT;

-- Usage counted once per AI-resolved conversation
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "usage_counted" BOOLEAN NOT NULL DEFAULT false;
