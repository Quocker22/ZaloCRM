-- Guideline engine (docs/THIET-KE-GUIDELINE-ENGINE.md).
-- IF NOT EXISTS: bảng/cột được tạo tay trên prod TRƯỚC khi deploy code mới
-- (Dokploy không tự migrate — xem quy trình deploy).

CREATE TABLE IF NOT EXISTS "ai_guidelines" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "ten" TEXT NOT NULL,
    "vai" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "muc_do" TEXT NOT NULL DEFAULT 'thuong',
    "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stage" TEXT,
    "uu_tien" INTEGER NOT NULL DEFAULT 100,
    "yeu_cau" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "ghi_chu" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ai_guidelines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_guidelines_org_id_ten_key"
    ON "ai_guidelines"("org_id", "ten");
CREATE INDEX IF NOT EXISTS "ai_guidelines_org_id_vai_enabled_idx"
    ON "ai_guidelines"("org_id", "vai", "enabled");

CREATE TABLE IF NOT EXISTS "guideline_match_logs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "vai" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "matched_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "duration_ms" INTEGER NOT NULL,
    "fallback" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "guideline_match_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "guideline_match_logs_org_id_created_at_idx"
    ON "guideline_match_logs"("org_id", "created_at");
CREATE INDEX IF NOT EXISTS "guideline_match_logs_conversation_id_idx"
    ON "guideline_match_logs"("conversation_id");

ALTER TABLE "ai_configs"
    ADD COLUMN IF NOT EXISTS "guideline_engine_mode" TEXT NOT NULL DEFAULT 'off';
