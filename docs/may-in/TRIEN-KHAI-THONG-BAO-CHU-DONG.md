# Triển khai: sự kiện in bền + luật thông báo (docs/78 C1/C2) — runbook

Áp cho nhánh `feat/ban-do-tin` (backend). Năm migration, đúng thứ tự:

| migration | làm gì | khoá |
|---|---|---|
| `20261002090000_print_su_kien` | bảng `print_su_kien`, `print_su_co` | chỉ tạo bảng |
| `20261002090100_bot_luat_thong_bao` | bảng `bot_luat_thong_bao`, `bot_ban_do_tin`; nới CHECK `bot_quyen_nhat_ky.doi_tuong` (+`luat_thong_bao`) | ACCESS EXCLUSIVE ngắn trên `bot_quyen_nhat_ky` |
| `20261002090300_print_su_kien_trigger_tao` | trigger `AFTER INSERT ON print_jobs` ghi dòng tạo `null → trang_thai` | SHARE ROW EXCLUSIVE ngắn trên `print_jobs` (chặn GHI job trong lúc tạo trigger) |
| `20261002090400_print_su_co_nhom` | cột `print_su_co.nhom_su_co` + index | bảng mới, tức thì |
| `20261002090500_bot_ban_do_tin_dinh` | cột `bot_ban_do_tin.composer_dinh`; nới CHECK `doi_tuong` (+`ban_do_tin`) | ACCESS EXCLUSIVE ngắn trên `bot_quyen_nhat_ky` |

`20261002090200_bot_luat_thong_bao_gieo` (gieo luật bằng migration) **đã bị xoá** khỏi nhánh trước khi lên đâu — luật chủ
chọn gieo bằng script (bước 4). DB thử nào lỡ áp nó: `DELETE FROM _prisma_migrations WHERE migration_name =
'20261002090200_bot_luat_thong_bao_gieo';` và xoá các dòng luật nó gieo (`sua_boi IS NULL`).

Mọi migration đặt `SET lock_timeout = '5s'`: chờ khoá quá 5 s thì HỎNG thay vì xếp hàng chặn truy vấn phía sau.

## 1. Thứ tự: MIGRATION TRƯỚC, MÃ SAU

- Mã mới ghi `print_su_kien` **cùng giao dịch** với mọi lần đổi trạng thái `print_jobs` (`capNhatJobCoSuKien`). Chạy mã
  mới trên DB CHƯA có bảng ⇒ mọi UPDATE trạng thái job **ném lỗi** ⇒ hàng đợi in đứng. Không bao giờ deploy mã trước.
- Mã cũ chạy trên schema mới thì an toàn: mã cũ không đọc bảng mới; trigger chỉ THÊM dòng vào `print_su_kien`; cột mới đều
  có DEFAULT hoặc thuộc bảng mới.

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
-- 090300: trigger có chưa?
SELECT tgname FROM pg_trigger WHERE tgname = 'print_jobs_su_kien_tao';
-- 090100 / 090500: CHECK đang nhận những gì?
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'bot_quyen_nhat_ky_doi_tuong_check';
-- 090400 / 090500: cột có chưa?
SELECT table_name, column_name FROM information_schema.columns
WHERE (table_name, column_name) IN (('print_su_co','nhom_su_co'), ('bot_ban_do_tin','composer_dinh'));
```

- Không có gì được áp (thường gặp): `npx prisma migrate resolve --rolled-back <tên migration>` rồi `npx prisma migrate
  deploy` lại lúc vắng hơn (tìm phiên giữ khoá: `SELECT pid, state, query FROM pg_stat_activity WHERE wait_event_type =
  'Lock' OR state = 'idle in transaction';`).
- Đã áp đủ (hiếm — lỗi xảy ra sau khi giao dịch đã commit): `npx prisma migrate resolve --applied <tên migration>`.

## 3. Lùi

Lùi MÃ trước (image cũ), schema mới để nguyên là an toàn (mục 1). Chỉ gỡ schema khi bỏ hẳn tính năng — chạy ngược thứ tự:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
-- 090500 + 090100: nhật ký của đối tượng mới phải xoá TRƯỚC khi siết CHECK lại
DELETE FROM bot_quyen_nhat_ky WHERE doi_tuong IN ('luat_thong_bao', 'ban_do_tin');
ALTER TABLE bot_quyen_nhat_ky DROP CONSTRAINT bot_quyen_nhat_ky_doi_tuong_check;
ALTER TABLE bot_quyen_nhat_ky ADD CONSTRAINT bot_quyen_nhat_ky_doi_tuong_check
    CHECK (doi_tuong IN ('nhom', 'nhan_vien', 'nick_crm'));
ALTER TABLE bot_ban_do_tin DROP COLUMN IF EXISTS composer_dinh;
-- 090400
DROP INDEX IF EXISTS print_su_co_org_id_may_in_id_id_idx;
ALTER TABLE print_su_co DROP COLUMN IF EXISTS nhom_su_co;
-- 090300
DROP TRIGGER IF EXISTS print_jobs_su_kien_tao ON print_jobs;
DROP FUNCTION IF EXISTS print_su_kien_tao_job();
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

Chỉ tắt sự kiện tạo job (giữ phần còn lại): `DROP TRIGGER print_jobs_su_kien_tao ON print_jobs;` — đổi trạng thái vẫn có
sự kiện, chỉ thiếu dòng `null → cho_in`.

## 4. Sau khi lên

1. Chờ bot gửi ảnh chụp bản đồ tin đầu tiên (`SELECT phien_ban, luc FROM bot_ban_do_tin WHERE org_id = '<org>'`).
2. Gieo luật chủ chọn 02/10 ở chế độ BÓNG (ghi sổ, không gửi):
   `npx tsx scripts/gieo-luat-thong-bao.ts --org <org_id>` — chưa có ảnh chụp thì script từ chối (409), chạy lại sau.
3. Chủ xem số bóng trên trang Bản đồ tin, rồi bật từng luật (PUT `/api/v1/bot-quyen/luat-thong-bao/:id` với
   `{cheDo: 'bat', phienBan}` — thiếu `phienBan` ⇒ 400).

## 5. Ghi nhớ cho bên bot

- Bot KHÔNG cần tự INSERT `print_su_kien` khi tạo job — trigger lo (phủ cả `INSERT print_jobs` thô của psycopg).
- `print_su_co`: gom theo `(may_in_id, nhom_su_co)`; dòng `het_su_co` / `tiep_tuc_in` là hồi phục (đóng sự cố cùng nhóm).
  CRM đã gộp lặp cùng (máy, mã) trong 10 phút khi chưa có hồi phục.
- Ảnh chụp bản đồ tin: gỡ nhãn `nhay_cam` hoặc đổi `khoa` → định tuyến được cho composer đã biết ⇒ 409 `NHAY_CAM_DINH`
  (sổ dính `composer_dinh`). Bớt nhạy cảm thật là việc vận hành trên DB, có lý do.
- Đích `nv` / `nguoi_gay_ra` CRM chỉ kiểm lúc LƯU — bot kiểm lại quyền + tạm im của người nhận lúc gửi.
- Cột `luc` của `print_su_kien` / `print_su_co` là giờ UTC (TIMESTAMP không múi giờ, như mọi cột Prisma) — so với
  `now() AT TIME ZONE 'UTC'`, không với `CURRENT_TIMESTAMP`.
