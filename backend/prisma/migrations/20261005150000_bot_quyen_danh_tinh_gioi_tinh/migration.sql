-- XƯNG HÔ TỰ ĐỘNG (05/10): giới tính HỒ SƠ ZALO của uid, đọc trong vòng danh tính (getUserInfo — User.gender, zca-js enum
-- Gender: 0 = Male, 1 = Female). CHỈ THÊM cột (NULL) — không backfill. `gioi_tinh_luc` = lần cuối đọc hồ sơ ĐỦ (có/không
-- giới); NULL ⇒ uid của nhân viên được đọc lại MỘT lần ở vòng kế (dòng có trước bản này chưa từng lưu giới).
SET lock_timeout = '5s';
ALTER TABLE "bot_quyen_danh_tinh" ADD COLUMN IF NOT EXISTS "gioi_tinh" TEXT;
ALTER TABLE "bot_quyen_danh_tinh" ADD COLUMN IF NOT EXISTS "gioi_tinh_luc" TIMESTAMPTZ(6);
ALTER TABLE "bot_quyen_danh_tinh" DROP CONSTRAINT IF EXISTS "bot_quyen_danh_tinh_gioi_tinh_check";
ALTER TABLE "bot_quyen_danh_tinh" ADD CONSTRAINT "bot_quyen_danh_tinh_gioi_tinh_check"
  CHECK ("gioi_tinh" IS NULL OR "gioi_tinh" IN ('male', 'female'));
