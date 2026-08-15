-- Nhóm C (15/08): khoá sửa tay + nguồn gốc cho alias học được.
ALTER TABLE "sp_alias" ADD COLUMN IF NOT EXISTS "locked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sp_alias" ADD COLUMN IF NOT EXISTS "locked_by" TEXT;
ALTER TABLE "sp_alias" ADD COLUMN IF NOT EXISTS "locked_at" TIMESTAMP(3);
ALTER TABLE "sp_alias" ADD COLUMN IF NOT EXISTS "nguon_loai" TEXT NOT NULL DEFAULT 'bot_hoc';
