-- Conversation indexes
CREATE INDEX "conversations_merchant_id_status_idx" ON "conversations"("merchant_id", "status");
CREATE INDEX "conversations_customer_email_idx" ON "conversations"("customer_email");
CREATE INDEX "conversations_created_at_idx" ON "conversations"("created_at");

-- Message indexes
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- Order indexes
CREATE INDEX "orders_merchant_id_customer_email_idx" ON "orders"("merchant_id", "customer_email");
CREATE INDEX "orders_shopify_order_id_idx" ON "orders"("shopify_order_id");

-- Knowledge base indexes
CREATE INDEX "knowledge_base_merchant_id_content_type_idx" ON "knowledge_base"("merchant_id", "content_type");

-- Event indexes
CREATE INDEX "events_merchant_id_event_type_created_at_idx" ON "events"("merchant_id", "event_type", "created_at");
CREATE INDEX "events_created_at_idx" ON "events"("created_at");
