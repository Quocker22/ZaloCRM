-- 25/09/2026: nhật ký máy in (hết giấy, kẹt giấy, lỗi in… + mọi sự kiện in)
-- để trang Cài đặt › Máy in tìm kiếm được. Xem backend/src/modules/ai/may-in/nhat-ky.ts
-- và HOP-DONG-NHAT-KY-MAY-IN.md §3.2.
--
-- IF NOT EXISTS mọi chỗ: prod từng tạo bảng máy in bằng SQL tay — chạy lại an toàn.
-- Code ghi nhật ký chịu được việc bảng CHƯA có (chỉ logger.warn, in vẫn chạy),
-- nên deploy code trước, chạy migration sau cũng không làm dừng máy in.
CREATE TABLE IF NOT EXISTS "print_logs" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "muc_do" TEXT NOT NULL,
  "loai" TEXT NOT NULL,
  "noi_dung" TEXT NOT NULL,
  "print_job_id" TEXT,
  "so_hoa_don" TEXT,
  "ten_khach" TEXT,
  "may_in_id" TEXT,
  "may_in_ten" TEXT,
  "agent_job_id" TEXT,
  "chi_tiet" JSONB,
  "tu_khoa" TEXT NOT NULL,
  CONSTRAINT "print_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "print_logs_org_id_created_at_idx" ON "print_logs"("org_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "print_logs_org_id_may_in_id_created_at_idx" ON "print_logs"("org_id", "may_in_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "print_logs_org_id_muc_do_created_at_idx" ON "print_logs"("org_id", "muc_do", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "print_logs_print_job_id_idx" ON "print_logs"("print_job_id");
CREATE INDEX IF NOT EXISTS "print_logs_so_hoa_don_idx" ON "print_logs"("so_hoa_don");
