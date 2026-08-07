-- Phiên gom đơn của máy trạng thái slot (spec 2026-08-07-luong-len-don-slot)
-- IF NOT EXISTS có chủ đích: bảng được tạo TAY trên prod TRƯỚC khi deploy code
-- mới (tránh cửa sổ thiếu bảng giữa lúc container đổi), rồi migrate deploy
-- chạy lại vẫn êm và ghi nhận migration bình thường.
CREATE TABLE IF NOT EXISTS "phien_gom_don" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "slots" JSONB NOT NULL,
    "het_han" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "phien_gom_don_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "phien_gom_don_conversation_id_key" ON "phien_gom_don"("conversation_id");
CREATE INDEX IF NOT EXISTS "phien_gom_don_het_han_idx" ON "phien_gom_don"("het_han");
