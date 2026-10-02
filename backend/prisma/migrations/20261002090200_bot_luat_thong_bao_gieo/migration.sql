-- 02/10/2026: GIEO luật chủ chọn 02/10 (docs/78 luat-chu-chon-02-10.json, dịch theo thuc-thi.md §5 P0-5):
--   xuat_hoa_don_tool → bản sao tới nhóm chức năng ke_toan, chế độ bat
--   in_sau_chot       → bản sao tới nhóm chức năng kho,     chế độ bat
-- `nhom_goc` của bản mẫu BỎ: nơi gốc luôn ngầm định, không bao giờ là đích của bản sao.
--
-- VÌ SAO là migration dữ liệu (chạy MỘT lần) chứ không gieo lúc khởi động: gieo mỗi lần khởi động sẽ DỰNG LẠI luật chủ đã
-- xoá. Ở đây `ON CONFLICT DO NOTHING` + chỉ chạy một lần ⇒ không bao giờ đè luật chủ đã sửa, và xoá là xoá hẳn.
-- Gieo cho MỌI org hiện có: lúc migration chạy, dữ liệu Quyền bot (bot_nhan_vien…) có thể chưa nhập nên không dùng làm
-- dấu hiệu "org dùng bot"; luật vô hại với org không có bot (chỉ bot của org đó đọc qua khoá API của org).
-- Kiểm cứng theo danh mục composer (bot-thong-bao-luat.ts) không chạy ở đây vì chưa có ảnh chụp — hai đích đều là nhóm
-- NỘI BỘ (ke_toan, kho), không phải nhóm khách, đúng luật cứng.
SET lock_timeout = '5s';

INSERT INTO "bot_luat_thong_bao" ("id", "org_id", "loai", "dich", "che_do", "dieu_kien", "gom_giay", "phien_ban", "sua_boi", "sua_luc")
SELECT gen_random_uuid()::text, o."id", l."loai", l."dich", 'bat', '{}'::jsonb, 0, 1, NULL, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES
    ('xuat_hoa_don_tool', '[{"kieu": "chuc_nang", "gia_tri": "ke_toan"}]'::jsonb),
    ('in_sau_chot',       '[{"kieu": "chuc_nang", "gia_tri": "kho"}]'::jsonb)
) AS l("loai", "dich")
ON CONFLICT ("org_id", "loai") DO NOTHING;
