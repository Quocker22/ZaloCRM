-- docs/79 T1 (02/10, sửa tự soát P1): dấu NV XÁC NHẬN giới tính Contact. CHỈ THÊM cột (NULL) — không backfill: khoá cũ
-- (gender_locked = true) không có dấu ⇒ bot KHÔNG tin (form lưu cả form từng đặt gender_locked ở mọi lần bấm Lưu).
SET lock_timeout = '5s';
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "gioi_tinh_xac_nhan_luc" TIMESTAMPTZ(6);
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "gioi_tinh_xac_nhan_boi" TEXT;
