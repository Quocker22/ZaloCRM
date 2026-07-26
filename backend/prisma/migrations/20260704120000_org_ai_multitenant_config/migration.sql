-- Org AI multi-tenant config (2026-07-04)
-- Bù migration bị thiếu cho commit 810280ef ("feat(ai): multi-tenant ... org AI config theo ngành").
-- schema.prisma đã khai báo 3 field này trên model Organization nhưng không có migration nào tạo cột
-- → DB dựng bằng `migrate deploy` bị thiếu cột `ai_industry` → POST /api/v1/setup crash P2022.
-- 3 cột khớp chính xác @map trong schema.prisma (Organization).

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "ai_biz_name" TEXT;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "ai_industry" TEXT NOT NULL DEFAULT 'ban_hang';
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "ai_prompt_extra" TEXT;
