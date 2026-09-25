-- 25/09/2026: MỨC ĐỘ của từng dòng nhật ký APP máy in (hợp đồng hàng đợi/huỷ v5,
-- docs/may-in/HOP-DONG-HANG-DOI-HUY-v5.md §5 + §8.9) — trang Cài đặt › Máy in › Log app lọc
-- được "Lỗi & cảnh báo" (vd hết giấy phải thấy trong nhóm sự cố/lỗi).
--
-- Backend phân loại LÚC LƯU (nhat-ky-app.ts phanLoaiMucDoApp). Câu CASE dưới đây được SINH
-- từ đúng bảng luật đó (sqlPhanLoaiMucDoApp) — test tests/ai/may-in/muc-do-app.test.ts khoá
-- "migration chứa đúng chuỗi sinh ra"; muc-do-app-sql.func.ts đối chiếu TS↔SQL trên Postgres
-- thật (CO_DB_TEST=1). So chữ trên dạng chuẩn hoá NFC ở cả hai phía (cần Postgres ≥ 13, DB UTF8).
--
-- IF NOT EXISTS mọi chỗ + backfill chỉ ghi dòng lệch: chạy lại an toàn (vd chạy lại sau khi
-- code cũ còn ghi vài dòng mặc định 'thong_tin' trong lúc deploy). Code mới chịu được việc cột
-- CHƯA có (ack CHUA_MIGRATE, app giữ lô gửi lại sau; trang xem trả 503) — in vẫn chạy.
ALTER TABLE "print_app_logs" ADD COLUMN IF NOT EXISTS "muc_do" TEXT NOT NULL DEFAULT 'thong_tin';

-- Backfill bằng CÙNG luật (CASE sinh từ LUAT_MUC_DO_APP) — chỉ ghi dòng có mức khác.
UPDATE "print_app_logs" SET "muc_do" = "phan_loai"."muc_do"
FROM (
  SELECT "id", CASE
    WHEN normalize("su_kien", NFC) IN (normalize('su_co', NFC)) THEN 'loi'
    WHEN left(normalize("su_kien", NFC), 9) = normalize('khong_in_', NFC) THEN 'loi'
    WHEN normalize("su_kien", NFC) IN (normalize('ket_qua', NFC)) AND (strpos(normalize("noi_dung", NFC), normalize('trang_thai=loi', NFC)) > 0 OR strpos(normalize("noi_dung", NFC), normalize('trang_thai=khong_ro', NFC)) > 0) THEN 'loi'
    WHEN normalize("su_kien", NFC) IN (normalize('trang_thai_may_in', NFC)) AND coalesce(substring(normalize("noi_dung", NFC) from E'^[ \t\r\n]*([^ \t\r\n]*)'), '') NOT IN (normalize('binh_thuong', NFC), normalize('het_muc', NFC)) THEN 'loi'
    WHEN normalize("su_kien", NFC) IN (normalize('usb_doc', NFC)) AND (strpos(normalize("noi_dung", NFC), normalize('TRỐNG', NFC)) > 0 OR strpos(normalize("noi_dung", NFC), normalize('báo lỗi', NFC)) > 0 OR strpos(normalize("noi_dung", NFC), normalize('hết giấy', NFC)) > 0) THEN 'loi'
    WHEN normalize("su_kien", NFC) IN (normalize('theo_doi_tiep_mat', NFC), normalize('theo_doi_tiep_het_han', NFC), normalize('tu_choi_ket_noi', NFC), normalize('sumatra_qua_han', NFC), normalize('sumatra_loi_cho', NFC)) THEN 'loi'
    WHEN normalize("su_kien", NFC) IN (normalize('tiep_tuc_loi', NFC)) THEN 'loi'
    WHEN normalize("su_kien", NFC) IN (normalize('trang_thai_may_in', NFC)) AND coalesce(substring(normalize("noi_dung", NFC) from E'^[ \t\r\n]*([^ \t\r\n]*)'), '') IN (normalize('het_muc', NFC)) THEN 'canh_bao'
    WHEN normalize("su_kien", NFC) IN (normalize('usb_doc', NFC)) AND (strpos(normalize("noi_dung", NFC), normalize('KHONG DOC DUOC', NFC)) > 0) THEN 'canh_bao'
    WHEN normalize("su_kien", NFC) IN (normalize('noi_that_bai', NFC), normalize('mat_ket_noi', NFC), normalize('gui_nhat_ky_loi', NFC), normalize('app_bo_dong', NFC), normalize('mat_job', NFC), normalize('ngat_client_cham', NFC), normalize('hop_thu_tran', NFC), normalize('theo_doi_tiep_bo', NFC), normalize('bo_theo_doi', NFC)) THEN 'canh_bao'
    WHEN normalize("su_kien", NFC) IN (normalize('huy_ket_qua', NFC)) AND left(coalesce(substring(normalize("noi_dung", NFC) from E'^[ \t\r\n]*([^ \t\r\n]*)'), ''), 8) = normalize('ok=false', NFC) THEN 'canh_bao'
    WHEN normalize("su_kien", NFC) IN (normalize('noi_lai_tu_dau', NFC), normalize('server_ban_cu', NFC), normalize('theo_doi_tiep_bo_qua', NFC)) THEN 'canh_bao'
    ELSE 'thong_tin'
  END AS "muc_do"
  FROM "print_app_logs"
) AS "phan_loai"
WHERE "print_app_logs"."id" = "phan_loai"."id" AND "print_app_logs"."muc_do" <> "phan_loai"."muc_do";

CREATE INDEX IF NOT EXISTS "print_app_logs_org_id_muc_do_luc_idx" ON "print_app_logs"("org_id", "muc_do", "luc" DESC);
