-- 02/10/2026: XƯNG HÔ NHÂN VIÊN (docs/79 T1) — bot gọi người này là "anh" hay "chị".
--   bot_nhan_vien.goi   'anh' | 'chi' | NULL (chưa chọn ⇒ bot giữ "anh/chị"). Người giữ trang Quyền bot chọn; CRM chỉ GỢI Ý
--                       từ contacts.gender (ưu tiên giá trị khoá tay), không bao giờ tự ghi.
-- Chỉ THÊM cột nullable (không DEFAULT ⇒ không viết lại bảng) + CHECK (bảng nhỏ, mọi dòng NULL ⇒ kiểm tức thì).
SET lock_timeout = '5s';

ALTER TABLE "bot_nhan_vien" ADD COLUMN "goi" TEXT;
ALTER TABLE "bot_nhan_vien" ADD CONSTRAINT "bot_nhan_vien_goi_check" CHECK ("goi" IS NULL OR "goi" IN ('anh', 'chi'));
