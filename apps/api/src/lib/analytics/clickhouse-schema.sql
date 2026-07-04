-- ClickHouse migration path for analytics events.
-- Apply when CLICKHOUSE_URL is configured:
--   clickhouse-client --multiquery < clickhouse-schema.sql

CREATE TABLE IF NOT EXISTS nova_events
(
    id UUID,
    merchant_id String,
    event_type LowCardinality(String),
    conversation_id Nullable(String),
    properties String,
    created_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(created_at)
ORDER BY (merchant_id, event_type, created_at)
TTL created_at + INTERVAL 24 MONTH;

CREATE TABLE IF NOT EXISTS nova_revenue_attributions
(
    id UUID,
    merchant_id String,
    conversation_id String,
    order_id Nullable(String),
    shopify_order_id Nullable(UInt64),
    attribution_type LowCardinality(String),
    revenue_type LowCardinality(String),
    amount Decimal(12, 2),
    properties String,
    attributed_at DateTime64(3, 'UTC')
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(attributed_at)
ORDER BY (merchant_id, attributed_at, conversation_id);

CREATE TABLE IF NOT EXISTS nova_analytics_daily
(
    merchant_id String,
    date Date,
    conversations_started UInt32,
    ai_responses UInt32,
    human_escalations UInt32,
    ai_resolutions UInt32,
    cart_recovered UInt32,
    orders_placed UInt32,
    widget_opened UInt32,
    proactive_triggered UInt32,
    recovered_cart_value Decimal(12, 2),
    saved_order_value Decimal(12, 2),
    upsell_value Decimal(12, 2),
    direct_revenue Decimal(12, 2),
    influence_revenue Decimal(12, 2),
    control_visitors UInt32,
    treatment_visitors UInt32,
    control_conversions UInt32,
    treatment_conversions UInt32,
    avg_response_ms Nullable(Float64),
    csat_score Nullable(Float64),
    resolution_rate Nullable(Float64)
)
ENGINE = ReplacingMergeTree
ORDER BY (merchant_id, date);
