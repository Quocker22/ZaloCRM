-- 30/09/2026: QUYỀN BOT — mặc định nhóm, vòng sửa review (docs/77 §8.2): lùi thử lại khi lỗi, "Zalo không trả nhóm" là
-- trạng thái dừng, mặc định cuối (nhật ký tự động), số sửa (bộ nhớ đệm API công khai). Chỉ THÊM cột/sequence/trigger.
--
-- lock_timeout: `prisma migrate deploy` chạy file này trong một phiên; ALTER TABLE cần khoá ACCESS EXCLUSIVE ngắn — nếu
-- một giao dịch dài đang giữ bảng, CHỜ quá 5 s thì HỎNG (chạy lại sau) thay vì xếp hàng chặn mọi truy vấn phía sau.
SET lock_timeout = '5s';

ALTER TABLE "bot_nhom_danh_sach"
    ADD COLUMN "so_lan_loi" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "thu_lai_sau" TIMESTAMP(3),
    ADD COLUMN "khong_tra" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "mac_dinh_cuoi" TEXT,
    ADD COLUMN "sua_so" BIGINT NOT NULL DEFAULT 0;

-- Mỗi lần INSERT/UPDATE dòng lấy một số MỚI (tăng dần toàn bảng) — mọi đường ghi (raw SQL, Prisma, tay) đều bị bắt.
CREATE SEQUENCE IF NOT EXISTS "bot_nhom_danh_sach_sua_so_seq";

CREATE OR REPLACE FUNCTION "bot_nhom_danh_sach_danh_so"() RETURNS trigger AS $$
BEGIN
    NEW."sua_so" := nextval('bot_nhom_danh_sach_sua_so_seq');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bot_nhom_danh_sach_danh_so"
    BEFORE INSERT OR UPDATE ON "bot_nhom_danh_sach"
    FOR EACH ROW EXECUTE FUNCTION "bot_nhom_danh_sach_danh_so"();
