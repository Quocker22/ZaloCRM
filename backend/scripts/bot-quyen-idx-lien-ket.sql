-- QUYỀN BOT (docs/77 §8b-an-toàn P1-4) — dựng TRƯỚC hai chỉ mục của migration 20260930210100_messages_idx_lien_ket.
--
-- Chạy bằng psql, NGOÀI giao dịch (không -1, không BEGIN):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/bot-quyen-idx-lien-ket.sql
-- Sau đó `prisma migrate deploy` như thường: migration dùng IF NOT EXISTS ⇒ no-op.
--
-- Nếu một câu hỏng giữa chừng (hết giờ, huỷ, deadlock) Postgres để lại chỉ mục INVALID — IF NOT EXISTS sẽ BỎ QUA nó.
-- Kiểm:
--   SELECT indexrelid::regclass, indisvalid FROM pg_index
--   WHERE indexrelid::regclass::text IN ('messages_zalo_msg_id_lien_ket_idx', 'messages_sender_uid_idx');
-- indisvalid = f ⇒ DROP INDEX CONCURRENTLY IF EXISTS "<tên>"; rồi chạy lại file này. Nếu migration đã ghi là failed:
--   npx prisma migrate resolve --rolled-back 20260930210100_messages_idx_lien_ket  (rồi deploy lại).
SET statement_timeout = 0;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_zalo_msg_id_lien_ket_idx" ON "messages" ("zalo_msg_id") WHERE "zalo_msg_id" IS NOT NULL AND "is_local" = false;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_sender_uid_idx" ON "messages" ("sender_uid") WHERE "sender_uid" IS NOT NULL;
