-- QUYỀN BOT (docs/77 §8b-an-toàn, giám sát LIVE 30/09 — D1). Chỉ sửa bảng HỆ THỐNG bot_quyen_danh_tinh. Chạy lại vô hại
-- (idempotent), mọi câu khoá theo org (join cùng org_id).
--
-- Sự cố staging: getGroupMembersInfo qua nick Vận Tải Minh Thức trả globalId CỦA CHÍNH nick gọi (4LGTI…) cho MỌI thành viên
-- ⇒ 4 dòng (Tiểu Mã, Trần Hưng, Viết Quốc, Cẩm Loan) mang globalId của VTMT ⇒ luật "nhiễm" coi globalId của VTMT là giữ chỗ
-- ⇒ không nhận ra ai. Mã mới chỉ đọc globalId bằng getUserInfo + rào (bot-quyen-danh-tinh.ts `locLoHoSo`).

-- (1) Nguồn mới: zalo_user_info (getUserInfo) · zalo_nick_ket_noi (hồ sơ chính nick lúc nối) · zalo_find_user. 'zalo_api'
--     (bản trước: không phân biệt getUserInfo với getGroupMembersInfo) giữ được trong CHECK cho dữ liệu cũ nhưng mã KHÔNG
--     dùng làm bằng chứng và KHÔNG tính là tươi.
ALTER TABLE "bot_quyen_danh_tinh" DROP CONSTRAINT IF EXISTS "bot_quyen_danh_tinh_nguon_check";
ALTER TABLE "bot_quyen_danh_tinh" ADD CONSTRAINT "bot_quyen_danh_tinh_nguon_check"
  CHECK ("nguon" IN ('zalo_api', 'zalo_find_user', 'zalo_user_info', 'zalo_nick_ket_noi'));
ALTER TABLE "bot_quyen_danh_tinh" ALTER COLUMN "nguon" SET DEFAULT 'zalo_user_info';

-- (2) XOÁ dòng hỏng: nick nhìn Y, uid ≠ uid của Y, globalId = globalId của CHÍNH Y (dòng Y tự nhìn mình). Hết dòng hỏng ⇒
--     globalId của Y hết "nhiễm" (nhiễm được TÍNH từ các dòng, không lưu riêng). uid bị xoá không còn dòng ⇒ vòng danh tính
--     kế đọc lại bằng getUserInfo.
DELETE FROM "bot_quyen_danh_tinh" d
USING "bot_quyen_danh_tinh" tu
JOIN "zalo_accounts" z ON z."id" = tu."zalo_account_id" AND z."org_id" = tu."org_id" AND z."zalo_uid" = tu."zalo_uid"
WHERE d."org_id" = tu."org_id"
  AND d."zalo_account_id" = tu."zalo_account_id"
  AND tu."global_id" IS NOT NULL AND btrim(tu."global_id") <> ''
  AND d."global_id" = tu."global_id"
  AND d."zalo_uid" <> tu."zalo_uid";

-- (3) Dòng nick TỰ nhìn mình của bản trước (getUserInfo(ownId) — lúc nối hoặc trong vòng) ⇒ nguồn tin được.
UPDATE "bot_quyen_danh_tinh" d SET "nguon" = 'zalo_nick_ket_noi'
FROM "zalo_accounts" z
WHERE z."id" = d."zalo_account_id" AND z."org_id" = d."org_id" AND z."zalo_uid" = d."zalo_uid" AND d."nguon" = 'zalo_api';

-- (4) Mọi dòng 'zalo_api' còn lại (người khác, nguồn không phân biệt được) ⇒ hết tươi ⇒ đọc lại bằng getUserInfo ngay vòng kế.
UPDATE "bot_quyen_danh_tinh" SET "lay_luc" = to_timestamp(0) WHERE "nguon" = 'zalo_api' AND "lay_luc" > to_timestamp(0);
