-- 02/10/2026: SỰ KIỆN IN bằng TRIGGER — cả TẠO lẫn ĐỔI TRẠNG THÁI (docs/78 C1, tự rà P0-1 + Codex v1 #4/#6).
-- (Tên thư mục giữ "trigger_tao" từ bản đầu; nội dung nay phủ cả UPDATE. Chưa áp lên môi trường nào ngoài DB test dùng một lần.)
--
-- VÌ SAO ở DB, không ở mã: job in không chỉ do mã CRM mới ghi. Bot INSERT print_jobs thẳng bằng psycopg (lednelia-agent
-- cong_cu_tools.py `_ghi_job_in`), người vận hành sửa/in lại bằng SQL tay, và bản image CŨ (khoảng migration → deploy, hoặc
-- sau khi lùi image) UPDATE print_jobs không qua helper. Ghi sự kiện ở mã thì các đường đó KHÔNG có dòng — trạm thông báo không
-- biết hoá đơn đã vào hàng in / đã huỷ. Trigger AFTER chạy CÙNG giao dịch với câu lệnh ⇒ rollback thì sự kiện cũng mất.
--
--   print_jobs_su_kien_tao  AFTER INSERT                ⇒ (NULL → trạng thái đầu), ma_loi NULL.
--   print_jobs_su_kien_doi  AFTER UPDATE OF trang_thai  ⇒ (OLD → NEW) khi trạng thái ĐỔI, HOẶC khi người gọi đặt mã lý do
--                           (thử lại cho_in → cho_in là sự kiện theo hợp đồng). Gán lại đúng trạng thái cũ mà không mã ⇒ không ghi.
--
-- MÃ LÝ DO (hợp đồng với su-kien-in.ts `capNhatJobCoSuKien`): người gọi đặt `set_config('zalocrm.ma_loi', '<mã>', true)` —
-- tham số TRANSACTION-LOCAL (tự xoá khi commit/rollback, không rò sang giao dịch sau trên cùng kết nối pool) — rồi UPDATE
-- trong CÙNG giao dịch. Không đặt (SQL tay, mã cũ) ⇒ ma_loi NULL. Chuỗi rỗng = không có mã.
--
-- An toàn hàm (Codex v1 #6):
--   • SECURITY DEFINER — bot ghi print_jobs bằng DSN `ZALOCRM_PRINT_DSN` (mặc định suy từ LEDNELIA_DATABASE_URL: CÙNG user
--     crmuser với CRM, đo 02/10 cong_cu_tools.py `_dsn_print_crm`). Kế hoạch phân quyền docs/76 N.02 sẽ cho bot một role riêng
--     KHÔNG có quyền INSERT print_su_kien — DEFINER để trigger vẫn ghi được bằng quyền chủ bảng khi đó.
--   • `SET search_path = pg_catalog, public, pg_temp` CỐ ĐỊNH (không `FROM CURRENT`) + bảng ghi bằng tên ĐỦ schema
--     `public.print_su_kien` ⇒ bảng TẠM cùng tên của người gọi không bắt được dòng (pg_temp đứng CUỐI). Hàm chỉ gọi
--     NULLIF/current_setting/left (pg_catalog đứng đầu). Quyền CREATE trên `public`: Postgres ≥ 15 mặc định thu của PUBLIC —
--     kiểm trên máy đích bằng `\dn+ public` (runbook docs/may-in/TRIEN-KHAI-THONG-BAO-CHU-DONG.md).
-- Trạng thái ngoài CHECK của print_su_kien ⇒ BỎ sự kiện (WARNING) chứ KHÔNG làm hỏng câu lệnh job: in là việc chính.
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.print_su_kien_tao_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    BEGIN
        INSERT INTO public.print_su_kien (org_id, job_id, tu_trang_thai, sang_trang_thai, ma_loi, luc)
        VALUES (NEW.org_id, NEW.id, NULL, NEW.trang_thai, NULL, now());
    EXCEPTION WHEN check_violation THEN
        RAISE WARNING 'print_su_kien: bỏ sự kiện tạo job % — trạng thái lạ %', NEW.id, NEW.trang_thai;
    END;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.print_su_kien_doi_trang_thai() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    v_ma text := NULLIF(current_setting('zalocrm.ma_loi', true), '');
BEGIN
    IF NEW.trang_thai IS NOT DISTINCT FROM OLD.trang_thai AND v_ma IS NULL THEN
        RETURN NULL;
    END IF;
    BEGIN
        INSERT INTO public.print_su_kien (org_id, job_id, tu_trang_thai, sang_trang_thai, ma_loi, luc)
        VALUES (NEW.org_id, NEW.id, OLD.trang_thai, NEW.trang_thai, left(v_ma, 64), now());
    EXCEPTION WHEN check_violation THEN
        RAISE WARNING 'print_su_kien: bỏ sự kiện đổi trạng thái job % — trạng thái lạ %', NEW.id, NEW.trang_thai;
    END;
    RETURN NULL;
END;
$$;

CREATE TRIGGER "print_jobs_su_kien_tao"
    AFTER INSERT ON public.print_jobs
    FOR EACH ROW EXECUTE FUNCTION public.print_su_kien_tao_job();

CREATE TRIGGER "print_jobs_su_kien_doi"
    AFTER UPDATE OF trang_thai ON public.print_jobs
    FOR EACH ROW EXECUTE FUNCTION public.print_su_kien_doi_trang_thai();
