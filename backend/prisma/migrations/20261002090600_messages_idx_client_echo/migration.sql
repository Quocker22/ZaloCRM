-- 02/10/2026: THÔNG BÁO CHỦ ĐỘNG (docs/78) — chỉ mục cho đối soát tin bot `chua_ro` (POST /api/public/ban-do-tin/doi-soat-echo).
--
-- `client_echo_id` ĐÃ được lưu từ 15/06 (20260615160000_mobile_device_echo) nhưng chỉ có UNIQUE (conversation_id, client_echo_id)
-- — đối soát tra theo echo trên CẢ org (bot không gửi hội thoại) ⇒ thiếu chỉ mục này là quét cả bảng messages.
-- Chỉ mục riêng phần (tin cũ/tin người gửi không có echo = NULL, không vào chỉ mục). Không đổi dữ liệu, không thêm cột.
--
-- CONCURRENTLY: không khoá ghi bảng messages lúc dựng; Prisma `migrate deploy` chạy file này KHÔNG bọc giao dịch (như
-- 20260930210100_messages_idx_lien_ket). File này CỐ Ý chỉ có MỘT câu. Prod có thể dựng TRƯỚC bằng psql đúng câu dưới
-- (IF NOT EXISTS ⇒ deploy thành no-op); dựng hỏng giữa chừng để lại chỉ mục INVALID ⇒ DROP INDEX CONCURRENTLY rồi dựng lại.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_client_echo_id_idx" ON "messages" ("client_echo_id") WHERE "client_echo_id" IS NOT NULL;
