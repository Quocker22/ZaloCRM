-- 17/08/2026: công tắc agent chuyển từ env AI_AGENT_* vào CRM (ai_configs).
ALTER TABLE "ai_configs" ADD COLUMN IF NOT EXISTS "agent_nhan_vien_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_configs" ADD COLUMN IF NOT EXISTS "agent_khach_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_configs" ADD COLUMN IF NOT EXISTS "agent_khach_tu_chot_enabled" BOOLEAN NOT NULL DEFAULT false;
