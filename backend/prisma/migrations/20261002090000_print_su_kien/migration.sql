-- 02/10/2026: THÔNG BÁO CHỦ ĐỘNG (docs/78 C1, Codex P0-3) — sự kiện in BỀN cho trạm thông báo của bot.
--   print_su_kien  một dòng mỗi lần print_jobs ĐỔI trạng thái (kể cả thử lại cho_in → cho_in và dòng tạo job) — ghi CÙNG
--                  GIAO DỊCH với UPDATE có điều kiện, chỉ khi UPDATE đổi đúng một dòng (su-kien-in.ts).
--   print_su_co    sự cố MÁY IN (app báo `su-co`, cầu dao `tam_giu`) — luồng riêng, không gắn trạng thái job.
-- Bot xác nhận TỪNG HÀNG bằng `bot_nhan_luc` (Codex P1-2: không dùng con trỏ id). Chỉ THÊM bảng — không đụng bảng cũ.
--
-- lock_timeout: như các migration 30/09 — chờ khoá quá 5 s thì HỎNG (chạy lại sau) thay vì chặn truy vấn phía sau.
SET lock_timeout = '5s';

CREATE TABLE "print_su_kien" (
    "id" BIGSERIAL NOT NULL,
    "org_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "tu_trang_thai" TEXT,
    "sang_trang_thai" TEXT NOT NULL,
    "ma_loi" TEXT,
    "luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bot_nhan_luc" TIMESTAMP(3),

    CONSTRAINT "print_su_kien_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "print_su_kien_org_id_luc_idx" ON "print_su_kien"("org_id", "luc" DESC);
CREATE INDEX "print_su_kien_job_id_idx" ON "print_su_kien"("job_id");
-- Hàng bot CHƯA nhận — bot đọc `WHERE bot_nhan_luc IS NULL ORDER BY id LIMIT n` (Prisma không khai được index một phần).
CREATE INDEX "print_su_kien_chua_nhan_idx" ON "print_su_kien"("id") WHERE "bot_nhan_luc" IS NULL;

-- Trạng thái đích phải là trạng thái job thật (hang-doi-in.ts TrangThaiJob) — giá trị lạ không được tới bot.
ALTER TABLE "print_su_kien" ADD CONSTRAINT "print_su_kien_sang_trang_thai_check"
    CHECK ("sang_trang_thai" IN ('cho_in', 'dang_gui', 'da_gui', 'da_in', 'khong_ro', 'loi', 'da_huy', 'bo_qua'));

CREATE TABLE "print_su_co" (
    "id" BIGSERIAL NOT NULL,
    "org_id" TEXT NOT NULL,
    "may_in_id" TEXT,
    "may_in_ten" TEXT,
    "print_job_id" TEXT,
    "so_hoa_don" TEXT,
    "ma_su_co" TEXT NOT NULL,
    "ma_goc" TEXT,
    "chi_tiet" TEXT,
    "luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bot_nhan_luc" TIMESTAMP(3),

    CONSTRAINT "print_su_co_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "print_su_co_org_id_luc_idx" ON "print_su_co"("org_id", "luc" DESC);
CREATE INDEX "print_su_co_chua_nhan_idx" ON "print_su_co"("id") WHERE "bot_nhan_luc" IS NULL;
