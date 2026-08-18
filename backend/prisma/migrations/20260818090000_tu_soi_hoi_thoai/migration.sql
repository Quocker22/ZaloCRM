-- 18/08/2026: bot tự soi hội thoại đã nguội → tự rút bài học (có nhật ký để gỡ).
ALTER TABLE "ai_guidelines" ADD COLUMN IF NOT EXISTS "nguon" TEXT NOT NULL DEFAULT 'nv_dan';
ALTER TABLE "ai_guidelines" ADD COLUMN IF NOT EXISTS "nguon_hoi_thoai" TEXT;

CREATE TABLE IF NOT EXISTS "tu_soi_hoi_thoai" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "den_message_id" TEXT NOT NULL,
  "vai" TEXT NOT NULL,
  "diem" INTEGER NOT NULL,
  "dauHieu" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "nhanXet" TEXT NOT NULL,
  "luat_da_ghi" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "alias_da_ghi" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "go_boi_user_id" TEXT,
  "go_luc" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tu_soi_hoi_thoai_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tu_soi_hoi_thoai_conversation_id_den_message_id_key" ON "tu_soi_hoi_thoai"("conversation_id", "den_message_id");
CREATE INDEX IF NOT EXISTS "tu_soi_hoi_thoai_org_id_created_at_idx" ON "tu_soi_hoi_thoai"("org_id", "created_at");
