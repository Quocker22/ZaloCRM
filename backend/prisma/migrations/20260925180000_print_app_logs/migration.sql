-- 25/09/2026: nhật ký APP máy in — TOÀN BỘ dòng app Windows ghi vào file .txt cục bộ,
-- app gửi lên qua event socket `nhat-ky-app` (namespace /print-agent). Trang
-- Cài đặt › Nhật ký app máy in xem/tìm/tải về. Xem backend/src/modules/ai/may-in/nhat-ky-app.ts.
--
-- Không lưu token máy in. `khoa` = sha1(token, luc, su_kien, noi_dung) UNIQUE: app gửi
-- lại một lô (mất ack) thì INSERT … ON CONFLICT DO NOTHING bỏ dòng trùng. Giữ 30 ngày
-- (cron máy in dọn theo nhan_luc).
--
-- IF NOT EXISTS mọi chỗ (như print_logs): chạy lại an toàn. Code nhận nhật ký app chịu
-- được việc bảng CHƯA có (ack CHUA_MIGRATE, app giữ lô gửi lại sau; in vẫn chạy), nên
-- deploy code trước, chạy migration sau cũng không làm dừng máy in.
CREATE TABLE IF NOT EXISTS "print_app_logs" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "may_in_id" TEXT,
  "may_in_ten" TEXT,
  "luc" TIMESTAMP(3) NOT NULL,
  "nhan_luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "su_kien" TEXT NOT NULL,
  "noi_dung" TEXT NOT NULL,
  "phien_ban" TEXT,
  "khoa" TEXT NOT NULL,
  "tu_khoa" TEXT NOT NULL,
  CONSTRAINT "print_app_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "print_app_logs_khoa_key" ON "print_app_logs"("khoa");
CREATE INDEX IF NOT EXISTS "print_app_logs_org_id_luc_id_idx" ON "print_app_logs"("org_id", "luc" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "print_app_logs_org_id_may_in_id_luc_idx" ON "print_app_logs"("org_id", "may_in_id", "luc" DESC);
CREATE INDEX IF NOT EXISTS "print_app_logs_org_id_su_kien_luc_idx" ON "print_app_logs"("org_id", "su_kien", "luc" DESC);
