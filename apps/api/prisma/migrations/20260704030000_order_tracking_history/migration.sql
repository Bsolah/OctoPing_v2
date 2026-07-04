-- AlterTable
ALTER TABLE "orders" ADD COLUMN "tracking_status" TEXT;
ALTER TABLE "orders" ADD COLUMN "estimated_delivery" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "tracking_history" JSONB;
ALTER TABLE "orders" ADD COLUMN "last_tracked_at" TIMESTAMP(3);
