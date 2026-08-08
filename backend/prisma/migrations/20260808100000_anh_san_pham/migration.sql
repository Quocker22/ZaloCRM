-- Ảnh sản phẩm theo URL từ Google Sheet (spec dong-bo-sheet 08/08).
-- IF NOT EXISTS: bảng được tạo tay trên prod TRƯỚC khi deploy code mới.
CREATE TABLE IF NOT EXISTS "anh_san_pham" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "ten" TEXT NOT NULL,
    "urls" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "anh_san_pham_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "anh_san_pham_org_id_ten_key" ON "anh_san_pham"("org_id", "ten");
