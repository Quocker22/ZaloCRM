-- 30/09/2026: QUYỀN BOT (docs/77 §8b-an-toàn P1-4) — chỉ mục cho truy vấn "cùng người qua nhiều nick".
--
-- Truy vấn liên kết (bot-quyen-cung-nguoi.ts) nối tin theo `zalo_msg_id` GIỮA các hội thoại và lọc theo `sender_uid`;
-- bảng messages chỉ có UNIQUE (conversation_id, zalo_msg_id) ⇒ không có hai chỉ mục này thì mỗi lần là quét cả bảng.
--
-- CONCURRENTLY: không khoá ghi bảng messages lúc dựng. Prisma 7 `migrate deploy` chạy file này KHÔNG bọc giao dịch (đã
-- thử trên Postgres 16: dựng được, indisvalid = t). File này CỐ Ý chỉ có hai câu CREATE INDEX — thêm câu khác (nhất là
-- BEGIN/SET LOCAL) là hỏng CONCURRENTLY.
-- Prod (bảng lớn): có thể dựng TRƯỚC bằng psql — `scripts/bot-quyen-idx-lien-ket.sql` (cùng tên, IF NOT EXISTS) — rồi
-- deploy như thường (file này thành no-op). Dựng hỏng giữa chừng để lại chỉ mục INVALID mà IF NOT EXISTS sẽ bỏ qua ⇒
-- xem hướng dẫn trong script đó.
-- Mã chạy ĐÚNG khi chưa có chỉ mục: truy vấn liên kết có `SET LOCAL statement_timeout` và lỗi/hết giờ ⇒ không nối ai.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_zalo_msg_id_lien_ket_idx" ON "messages" ("zalo_msg_id") WHERE "zalo_msg_id" IS NOT NULL AND "is_local" = false;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_sender_uid_idx" ON "messages" ("sender_uid") WHERE "sender_uid" IS NOT NULL;
