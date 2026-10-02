# Triển khai: sự kiện in bền + luật thông báo (docs/78 C1/C2) — runbook

Áp cho nhánh `feat/ban-do-tin` (backend). Năm migration, đúng thứ tự:

| migration | làm gì | khoá |
|---|---|---|
| `20261002090000_print_su_kien` | bảng `print_su_kien`, `print_su_co` (`luc`/`bot_nhan_luc` **timestamptz**) | chỉ tạo bảng |
| `20261002090100_bot_luat_thong_bao` | bảng `bot_luat_thong_bao`, `bot_ban_do_tin`; nới CHECK `bot_quyen_nhat_ky.doi_tuong` (+`luat_thong_bao`) | ACCESS EXCLUSIVE ngắn trên `bot_quyen_nhat_ky` |
| `20261002090300_print_su_kien_trigger_tao` | HAI trigger trên `print_jobs`: `print_jobs_su_kien_tao` (AFTER INSERT ⇒ `null → trang_thai`) + `print_jobs_su_kien_doi` (AFTER UPDATE OF trang_thai ⇒ `OLD → NEW` khi đổi, hoặc khi có mã `zalocrm.ma_loi`); hàm SECURITY DEFINER, `search_path = pg_catalog, public, pg_temp`, ghi `public.print_su_kien` | SHARE ROW EXCLUSIVE ngắn trên `print_jobs` (chặn GHI job trong lúc tạo trigger) |
| `20261002090400_print_su_co_nhom` | cột `print_su_co.nhom_su_co` + index | bảng mới, tức thì |
| `20261002090500_bot_ban_do_tin_dinh` | cột `bot_ban_do_tin.composer_dinh`, `bot_ban_do_tin.nguon`; nới CHECK `doi_tuong` (+`ban_do_tin`) | ACCESS EXCLUSIVE ngắn trên `bot_quyen_nhat_ky` |

`20261002090200_bot_luat_thong_bao_gieo` (gieo luật bằng migration) **đã bị xoá** khỏi nhánh trước khi lên đâu — luật chủ
chọn gieo bằng script (bước 4). DB thử nào lỡ áp nó: `DELETE FROM _prisma_migrations WHERE migration_name =
'20261002090200_bot_luat_thong_bao_gieo';` và xoá các dòng luật nó gieo (`sua_boi IS NULL`).

Mọi migration đặt `SET lock_timeout = '5s'`: chờ khoá quá 5 s thì HỎNG thay vì xếp hàng chặn truy vấn phía sau.

## 1. Thứ tự: MIGRATION TRƯỚC, MÃ SAU

- Sự kiện đổi trạng thái do **TRIGGER** ghi (Codex v1 #4) — mã mới KHÔNG tự INSERT `print_su_kien`; nó chỉ khoá dòng job,
  đặt mã lý do `set_config('zalocrm.ma_loi', '<mã>', true)` (transaction-local) rồi UPDATE có điều kiện. Mọi đường ghi
  `print_jobs` (mã CRM, bot psycopg, SQL tay, image CŨ) đều sinh đúng MỘT sự kiện; đường không đặt mã ⇒ `ma_loi` NULL.
- Mã mới trên DB CHƯA có bảng: đổi trạng thái job vẫn chạy (không đụng bảng mới), nhưng sự cố máy (`print_su_co`) ghi
  không được ⇒ dồn vào hàng thử lại RAM, trang Bản đồ tin / luật lỗi 500. Vẫn: **migration trước**.
- Mã cũ (image trước nhánh này) trên schema mới: an toàn — trigger sinh sự kiện cho mọi UPDATE trạng thái của mã cũ
  (không có `ma_loi`); cột mới đều có DEFAULT hoặc thuộc bảng mới.
- **ĐỪNG deploy image dựng từ commit trung gian `81875a9..4a02754`** của nhánh: các bản đó tự INSERT `print_su_kien` ở mã
  ⇒ cộng với trigger UPDATE là HAI dòng mỗi lần đổi trạng thái.
- Kết nối Prisma của CRM ghim `TimeZone=UTC` (`prisma-client.ts` `taoAdapterPg`): @prisma/adapter-pg 7.5 cắt bỏ độ lệch
  khi đọc timestamptz — phiên ở `Asia/Ho_Chi_Minh` đọc lệch 7 giờ (đo 02/10). Bot đọc bằng psycopg ⇒ không bị.

Kiểm quyền trên DB đích (hàm trigger SECURITY DEFINER chạy bằng quyền CHỦ hàm): không role nào ngoài chủ được CREATE trong
schema `public` (Postgres ≥ 15 mặc định đã thu của PUBLIC):

```sql
SELECT nspname, nspacl FROM pg_namespace WHERE nspname = 'public';   -- không có "=UC/" cho PUBLIC
SELECT current_setting('server_version'), rolname, rolsuper FROM pg_roles WHERE rolname = current_user;
```

Bot ghi `print_jobs` bằng DSN `ZALOCRM_PRINT_DSN` (mặc định suy từ `LEDNELIA_DATABASE_URL` — CÙNG user `crmuser` với CRM,
lednelia-agent `cong_cu_tools.py` `_dsn_print_crm`). Khi bot có role riêng (docs/76 N.02) role đó KHÔNG cần quyền trên
`print_su_kien` — trigger DEFINER ghi hộ.

Trước khi áp, kiểm trên đúng DB đích:

```sql
SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
WHERE migration_name LIKE '20261002%' ORDER BY migration_name;
```

Áp: `npx prisma migrate deploy` trong container app (scripts/zalocrm-deploy.sh `migrate()`), giờ vắng (không có lệnh in
đang chạy). Rồi mới deploy image mới.

## 2. Migration hỏng vì `lock_timeout`

Dấu hiệu: `canceling statement due to lock timeout`; lần `migrate deploy` sau báo P3009 (có migration hỏng). Mỗi file
migration Postgres chạy như một khối nguyên tử (nhiều câu lệnh một lần gửi ⇒ một giao dịch ngầm) — hỏng là KHÔNG có gì
được áp. Kiểm cho chắc rồi đánh dấu và chạy lại:

```sql
-- 090300: hai trigger có chưa?
SELECT tgname FROM pg_trigger WHERE tgname IN ('print_jobs_su_kien_tao', 'print_jobs_su_kien_doi');
-- 090100 / 090500: CHECK đang nhận những gì?
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'bot_quyen_nhat_ky_doi_tuong_check';
-- 090400 / 090500: cột có chưa?
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name, column_name) IN (('print_su_co','nhom_su_co'), ('bot_ban_do_tin','composer_dinh'), ('bot_ban_do_tin','nguon'));
```

- Không có gì được áp (thường gặp): `npx prisma migrate resolve --rolled-back <tên migration>` rồi `npx prisma migrate
  deploy` lại lúc vắng hơn (tìm phiên giữ khoá: `SELECT pid, state, query FROM pg_stat_activity WHERE wait_event_type =
  'Lock' OR state = 'idle in transaction';`).
- Đã áp đủ (hiếm — lỗi xảy ra sau khi giao dịch đã commit): `npx prisma migrate resolve --applied <tên migration>`.

## 3. Lùi

Lùi MÃ trước (image cũ), schema mới để nguyên là an toàn (mục 1) — và **dòng sự kiện vẫn đủ**: trigger ghi cả UPDATE của
image cũ (chỉ thiếu `ma_loi`). Cái mất khi lùi image: sự cố máy (`print_su_co`) — image cũ không ghi bảng đó; trạm thông
báo thấy "không có sự cố" chứ không thấy sự cố sai. Chỉ gỡ schema khi bỏ hẳn tính năng — chạy ngược thứ tự:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
-- 090500 + 090100: nhật ký của đối tượng mới phải xoá TRƯỚC khi siết CHECK lại
DELETE FROM bot_quyen_nhat_ky WHERE doi_tuong IN ('luat_thong_bao', 'ban_do_tin');
ALTER TABLE bot_quyen_nhat_ky DROP CONSTRAINT bot_quyen_nhat_ky_doi_tuong_check;
ALTER TABLE bot_quyen_nhat_ky ADD CONSTRAINT bot_quyen_nhat_ky_doi_tuong_check
    CHECK (doi_tuong IN ('nhom', 'nhan_vien', 'nick_crm'));
ALTER TABLE bot_ban_do_tin DROP COLUMN IF EXISTS composer_dinh;
ALTER TABLE bot_ban_do_tin DROP COLUMN IF EXISTS nguon;
-- 090400
DROP INDEX IF EXISTS print_su_co_org_id_may_in_id_id_idx;
ALTER TABLE print_su_co DROP COLUMN IF EXISTS nhom_su_co;
-- 090300 (cả hai trigger + hai hàm)
DROP TRIGGER IF EXISTS print_jobs_su_kien_tao ON print_jobs;
DROP TRIGGER IF EXISTS print_jobs_su_kien_doi ON print_jobs;
DROP FUNCTION IF EXISTS public.print_su_kien_tao_job();
DROP FUNCTION IF EXISTS public.print_su_kien_doi_trang_thai();
-- 090100
DROP TABLE IF EXISTS bot_luat_thong_bao;
DROP TABLE IF EXISTS bot_ban_do_tin;
-- 090000
DROP TABLE IF EXISTS print_su_kien;
DROP TABLE IF EXISTS print_su_co;
DELETE FROM _prisma_migrations WHERE migration_name IN (
  '20261002090000_print_su_kien', '20261002090100_bot_luat_thong_bao', '20261002090300_print_su_kien_trigger_tao',
  '20261002090400_print_su_co_nhom', '20261002090500_bot_ban_do_tin_dinh');
COMMIT;
```

Tắt tạm sự kiện in (giữ bảng, ví dụ trigger gây sự cố hiệu năng): `DROP TRIGGER print_jobs_su_kien_doi ON print_jobs;`
(và/hoặc `print_jobs_su_kien_tao`). Mã mới vẫn chạy (đặt `zalocrm.ma_loi` vô hại khi không có trigger đọc) — nhưng trạm
thông báo mất sự kiện tương ứng. Bật lại = chạy lại hai câu `CREATE TRIGGER` trong migration 090300.

## 4. Sau khi lên

0. (Khuyến nghị — Codex v1 #1, ảnh chụp ĐẦU TIÊN được tin) Đặt khoá RIÊNG của bot TRƯỚC lần đẩy đầu:
   `INSERT INTO app_settings (id, org_id, setting_key, value_plain, updated_at) VALUES (gen_random_uuid(), '<org>',
   'bot_ban_do_tin_api_key', '<khoá ngẫu nhiên ≥ 32 ký tự>', now());` rồi đặt khoá đó vào env bridge của bot. Có khoá riêng
   ⇒ `POST /api/public/ban-do-tin` bằng khoá chung bị 403 `CAN_KHOA_RIENG_BOT`.
1. Chờ bot gửi ảnh chụp bản đồ tin đầu tiên (`SELECT phien_ban, luc FROM bot_ban_do_tin WHERE org_id = '<org>'`).
2. Gieo luật chủ chọn 02/10 ở chế độ BÓNG (ghi sổ, không gửi):
   `npx tsx scripts/gieo-luat-thong-bao.ts --org <org_id>` — chưa có ảnh chụp thì script từ chối (409), chạy lại sau.
3. Chủ xem số bóng trên trang Bản đồ tin, rồi bật từng luật (PUT `/api/v1/bot-quyen/luat-thong-bao/:id` với
   `{cheDo: 'bat', phienBan}` — thiếu `phienBan` ⇒ 400).

## 5. Ghi nhớ cho bên bot

- Bot KHÔNG tự INSERT `print_su_kien` (cả khi tạo job lẫn khi đổi trạng thái) — trigger lo. Muốn kèm mã lý do khi bot tự
  UPDATE trạng thái: `SELECT set_config('zalocrm.ma_loi', '<mã ≤ 64>', true)` trong CÙNG giao dịch, TRƯỚC câu UPDATE.
- `print_su_co`: một sự cố = `(org, may_in_id, nhom_su_co)`; dòng `het_su_co` / `tiep_tuc_in` là hồi phục và chỉ đóng
  ĐÚNG nhóm của nó (hết giấy + kẹt giấy cùng lúc là hai nhóm, hai hồi phục). CRM gộp lặp cùng (máy, nhóm, mã) trong 10
  phút khi nhóm chưa hồi phục.
- CRM "lưu rồi mới đánh dấu": DB chập thì trạng thái máy được ghi bù ở nhịp báo trạng thái kế tiếp (20 s), sự cố một lần
  (`su-co`, `tam_giu`, hồi phục khi in được) nằm trong hàng thử lại RAM (thử lại 30 s, giờ gốc) — mất nếu tiến trình dừng
  trước khi DB sống lại; trạng thái máy thì tiến trình mới đọc dòng cuối trong DB rồi bù.
- Ảnh chụp bản đồ tin: hợp đồng ở `docs/may-in/HOP-DONG-BAN-DO-TIN.md` (= docs/78 `hop-dong-ban-do-tin.md` repo bot).
  Gỡ nhãn `nhay_cam` / đổi `khoa` của composer đã biết ⇒ 409 `NHAY_CAM_DINH` (sổ dính `composer_dinh`). Luật phát cho bot
  kiểm theo HỢP ảnh chụp hiện tại ∪ sổ dính; composer không có ở cả hai ⇒ `dich: []` + `canh_bao`.
- Đích `nv` / `nguoi_gay_ra` CRM chỉ kiểm lúc LƯU — bot kiểm lại quyền + tạm im của người nhận lúc gửi.
- Cột `luc` / `bot_nhan_luc` của `print_su_kien` / `print_su_co` là **timestamptz** — so thẳng với `now()`; psycopg trả
  datetime có múi giờ.
