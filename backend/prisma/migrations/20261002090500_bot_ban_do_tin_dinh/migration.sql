-- 02/10/2026: ẢNH CHỤP BẢN ĐỒ TIN — nhạy cảm DÍNH + nhật ký (docs/78 C2, tự rà P1-5).
--   bot_ban_do_tin.composer_dinh  sổ {id composer: {nhay_cam, khoa}} = hợp của MỌI ảnh chụp đã nhận. Ảnh chụp mới (khoá API)
--                                 không gỡ được nhãn nhạy cảm / mở khoá composer đã có trong sổ ⇒ 409, giữ bản cũ.
--   bot_ban_do_tin.nguon          nguồn giả (máy in / Odoo / lịch) + cạnh dan_toi của chúng (Codex v1 #7).
--   bot_quyen_nhat_ky             nhận doi_tuong 'ban_do_tin' (ai = api_key:<id cài đặt>) — ghi khi danh mục đổi + lần bị từ chối.
-- Chỉ THÊM cột (có DEFAULT hằng ⇒ không viết lại bảng) + nới CHECK (bảng nhỏ).
SET lock_timeout = '5s';

ALTER TABLE "bot_ban_do_tin" ADD COLUMN "composer_dinh" JSONB NOT NULL DEFAULT '{}';
-- Nguồn giả của bản đồ (máy in / Odoo / lịch) theo hợp đồng ảnh chụp (Codex v1 #7, hop-dong-ban-do-tin.md).
ALTER TABLE "bot_ban_do_tin" ADD COLUMN "nguon" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "bot_quyen_nhat_ky" DROP CONSTRAINT "bot_quyen_nhat_ky_doi_tuong_check";
ALTER TABLE "bot_quyen_nhat_ky" ADD CONSTRAINT "bot_quyen_nhat_ky_doi_tuong_check"
    CHECK ("doi_tuong" IN ('nhom', 'nhan_vien', 'nick_crm', 'luat_thong_bao', 'ban_do_tin'));
