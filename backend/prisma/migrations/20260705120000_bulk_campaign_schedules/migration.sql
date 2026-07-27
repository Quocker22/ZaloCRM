-- Bù migration thiếu cho model BulkCampaignSchedule (schema.prisma:2752).
-- Không migration nào tạo bảng → cron bulk-campaign crash mỗi giờ (relation không tồn tại).
CREATE TABLE IF NOT EXISTS "bulk_campaign_schedules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "customer_list_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "per_day" INTEGER NOT NULL DEFAULT 20,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "last_run_sent" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bulk_campaign_schedules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "bulk_campaign_schedules_customer_list_id_zalo_account_id_mode_key"
    ON "bulk_campaign_schedules"("customer_list_id", "zalo_account_id", "mode");
CREATE INDEX IF NOT EXISTS "bulk_campaign_schedules_enabled_last_run_at_idx"
    ON "bulk_campaign_schedules"("enabled", "last_run_at");
