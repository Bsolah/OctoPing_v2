-- Conversation attribution fields
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "ended_at" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "cart_product_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "cart_value_at_start" DECIMAL(12,2);
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "visitor_id" TEXT;

CREATE INDEX IF NOT EXISTS "conversations_visitor_id_idx" ON "conversations"("visitor_id");
CREATE INDEX IF NOT EXISTS "conversations_ended_at_idx" ON "conversations"("ended_at");

-- Order product ids for cart exclusion
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "product_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
CREATE INDEX IF NOT EXISTS "orders_merchant_id_created_at_idx" ON "orders"("merchant_id", "created_at");

-- Revenue attributions
CREATE TABLE IF NOT EXISTS "revenue_attributions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "order_id" TEXT,
    "shopify_order_id" BIGINT,
    "attribution_type" TEXT NOT NULL,
    "revenue_type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "properties" JSONB,
    "attributed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_attributions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "revenue_attributions_conversation_id_order_id_revenue_type_key"
  ON "revenue_attributions"("conversation_id", "order_id", "revenue_type");
CREATE INDEX IF NOT EXISTS "revenue_attributions_merchant_id_attributed_at_idx"
  ON "revenue_attributions"("merchant_id", "attributed_at");
CREATE INDEX IF NOT EXISTS "revenue_attributions_conversation_id_idx"
  ON "revenue_attributions"("conversation_id");

ALTER TABLE "revenue_attributions"
  DROP CONSTRAINT IF EXISTS "revenue_attributions_merchant_id_fkey";
ALTER TABLE "revenue_attributions"
  ADD CONSTRAINT "revenue_attributions_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "revenue_attributions"
  DROP CONSTRAINT IF EXISTS "revenue_attributions_conversation_id_fkey";
ALTER TABLE "revenue_attributions"
  ADD CONSTRAINT "revenue_attributions_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "revenue_attributions"
  DROP CONSTRAINT IF EXISTS "revenue_attributions_order_id_fkey";
ALTER TABLE "revenue_attributions"
  ADD CONSTRAINT "revenue_attributions_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Daily rollups
CREATE TABLE IF NOT EXISTS "analytics_daily_summaries" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "conversations_started" INTEGER NOT NULL DEFAULT 0,
    "ai_responses" INTEGER NOT NULL DEFAULT 0,
    "human_escalations" INTEGER NOT NULL DEFAULT 0,
    "ai_resolutions" INTEGER NOT NULL DEFAULT 0,
    "cart_recovered" INTEGER NOT NULL DEFAULT 0,
    "orders_placed" INTEGER NOT NULL DEFAULT 0,
    "widget_opened" INTEGER NOT NULL DEFAULT 0,
    "proactive_triggered" INTEGER NOT NULL DEFAULT 0,
    "recovered_cart_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saved_order_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "upsell_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "direct_revenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "influence_revenue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "control_visitors" INTEGER NOT NULL DEFAULT 0,
    "treatment_visitors" INTEGER NOT NULL DEFAULT 0,
    "control_conversions" INTEGER NOT NULL DEFAULT 0,
    "treatment_conversions" INTEGER NOT NULL DEFAULT 0,
    "avg_response_ms" DOUBLE PRECISION,
    "csat_score" DOUBLE PRECISION,
    "resolution_rate" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_daily_summaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "analytics_daily_summaries_merchant_id_date_key"
  ON "analytics_daily_summaries"("merchant_id", "date");
CREATE INDEX IF NOT EXISTS "analytics_daily_summaries_merchant_id_date_idx"
  ON "analytics_daily_summaries"("merchant_id", "date");

ALTER TABLE "analytics_daily_summaries"
  DROP CONSTRAINT IF EXISTS "analytics_daily_summaries_merchant_id_fkey";
ALTER TABLE "analytics_daily_summaries"
  ADD CONSTRAINT "analytics_daily_summaries_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
