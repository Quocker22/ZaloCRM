-- THÔNG BÁO CHỦ ĐỘNG (docs/78) — dựng TRƯỚC chỉ mục của migration 20261002090600_messages_idx_client_echo (như
-- scripts/bot-quyen-idx-lien-ket.sql cho 20260930210100).
--
-- Chạy bằng psql, NGOÀI giao dịch (không -1, không BEGIN):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ban-do-tin-idx-client-echo.sql
-- Sau đó `prisma migrate deploy` như thường: migration dùng IF NOT EXISTS ⇒ no-op.
--
-- Hỏng giữa chừng (hết giờ, huỷ, deadlock) ⇒ Postgres để lại chỉ mục INVALID mà IF NOT EXISTS sẽ BỎ QUA. Kiểm:
--   SELECT indexrelid::regclass, indisvalid FROM pg_index WHERE indexrelid::regclass::text = 'messages_client_echo_id_idx';
-- indisvalid = f ⇒ DROP INDEX CONCURRENTLY IF EXISTS "messages_client_echo_id_idx"; rồi chạy lại file này. Nếu migration đã
-- ghi là failed: npx prisma migrate resolve --rolled-back 20261002090600_messages_idx_client_echo (rồi deploy lại).
--
-- Chỉ mục này KHÔNG khai trong schema.prisma (Prisma không diễn tả được WHERE). Prisma 7.5 bỏ qua nó khi diff (đo 02/10);
-- nếu bản sau `prisma migrate dev` đòi DROP thì xoá dòng đó khỏi migration sinh ra (tests/migration-chi-muc-concurrently.test.ts canh).
SET statement_timeout = 0;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_client_echo_id_idx" ON "messages" ("client_echo_id") WHERE "client_echo_id" IS NOT NULL;
