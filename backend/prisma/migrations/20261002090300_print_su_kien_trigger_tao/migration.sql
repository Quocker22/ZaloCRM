-- 02/10/2026: SỰ KIỆN TẠO JOB bằng TRIGGER (docs/78 C1, tự rà P0-1).
-- Job in không chỉ do CRM tạo: bot INSERT print_jobs thẳng bằng psycopg (lednelia-agent cong_cu_tools.py `_ghi_job_in`),
-- người vận hành in lại bằng SQL tay. Ghi sự kiện tạo ở mã CRM thì các job đó KHÔNG có dòng `null → cho_in` — trạm thông
-- báo không biết hoá đơn đã vào hàng in. Trigger AFTER INSERT phủ MỌI đường, cùng giao dịch với INSERT job. Mã CRM
-- (su-kien-in.ts taoJobCoSuKien) THÔI tự ghi dòng tạo — ghi cả hai là hai dòng. Các lần ĐỔI trạng thái vẫn ghi ở mã (kèm ma_loi).
--
-- SECURITY DEFINER: vai DB của bot có thể không có quyền INSERT print_su_kien — trigger chạy bằng quyền chủ bảng.
-- Trạng thái ngoài CHECK của print_su_kien ⇒ BỎ sự kiện (WARNING) chứ KHÔNG làm hỏng việc tạo job: in là việc chính.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION "print_su_kien_tao_job"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path FROM CURRENT AS $$
BEGIN
    BEGIN
        -- `luc` theo GIỜ UTC như Prisma ghi (cột TIMESTAMP không múi giờ; Prisma gửi now() UTC) — DEFAULT CURRENT_TIMESTAMP
        -- sẽ ra giờ theo TimeZone của phiên DB, lệch 7 giờ với các dòng mã CRM ghi nếu DB không đặt UTC.
        INSERT INTO "print_su_kien" ("org_id", "job_id", "tu_trang_thai", "sang_trang_thai", "luc")
        VALUES (NEW."org_id", NEW."id", NULL, NEW."trang_thai", (now() AT TIME ZONE 'UTC'));
    EXCEPTION WHEN check_violation THEN
        RAISE WARNING 'print_su_kien: bỏ sự kiện tạo job % — trạng thái lạ %', NEW."id", NEW."trang_thai";
    END;
    RETURN NULL;
END;
$$;

CREATE TRIGGER "print_jobs_su_kien_tao"
    AFTER INSERT ON "print_jobs"
    FOR EACH ROW EXECUTE FUNCTION "print_su_kien_tao_job"();
