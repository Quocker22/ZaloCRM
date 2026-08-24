-- 24/08/2026: hàng đợi in hoá đơn ra máy in shop (HP LaserJet Pro 4003, IPP).
-- Tool in_hoa_don chỉ tạo hàng; cron may-in nhặt in, luật A3 chống in đôi.
CREATE TABLE IF NOT EXISTS "print_jobs" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "conversation_id" TEXT,
  "hoa_don_id" INTEGER NOT NULL,
  "so_hoa_don" TEXT NOT NULL,
  "report" TEXT NOT NULL,
  "trang_thai" TEXT NOT NULL DEFAULT 'cho_in',
  "lan_thu" INTEGER NOT NULL DEFAULT 0,
  "ipp_job_id" INTEGER,
  "loi_cuoi" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "print_jobs_trang_thai_created_at_idx" ON "print_jobs"("trang_thai", "created_at");
CREATE INDEX IF NOT EXISTS "print_jobs_org_id_created_at_idx" ON "print_jobs"("org_id", "created_at");
