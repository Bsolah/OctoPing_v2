-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "ai_paused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "conversations" ADD COLUMN "assigned_agent_id" TEXT;
ALTER TABLE "conversations" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "conversations" ADD COLUMN "escalation_context" JSONB;
ALTER TABLE "conversations" ADD COLUMN "queued_at" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN "sla_due_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "conversations_merchant_id_assigned_agent_id_idx" ON "conversations"("merchant_id", "assigned_agent_id");
CREATE INDEX "conversations_merchant_id_priority_idx" ON "conversations"("merchant_id", "priority");
