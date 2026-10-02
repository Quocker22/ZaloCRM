-- 02/10/2026: NHÓM SỰ CỐ + gộp theo máy (docs/78 C1, tự rà P1-4).
--   nhom_su_co  = COALESCE(ma_goc, ma_su_co) do mã ghi (su-kien-in.ts nhomSuCo): `su-co het_giay`, `tam_giu` ma_goc=het_giay
--               và hồi phục `het_su_co`/`tiep_tuc_in` ma_goc=het_giay là MỘT sự cố ⇒ bot gom theo (máy, nhom_su_co).
--   index       (org_id, may_in_id, id) cho bước gộp "cùng máy + mã trong 10 phút, chưa có hồi phục" (ghiSuCoIn).
-- Bảng mới từ 20261002090000 (chưa lên môi trường nào) — điền lại rồi NOT NULL là tức thì.
SET lock_timeout = '5s';

ALTER TABLE "print_su_co" ADD COLUMN "nhom_su_co" TEXT;
UPDATE "print_su_co" SET "nhom_su_co" = COALESCE("ma_goc",
    CASE WHEN "ma_su_co" IN ('tam_giu', 'het_su_co', 'tiep_tuc_in') THEN 'khong_ro' ELSE "ma_su_co" END);
ALTER TABLE "print_su_co" ALTER COLUMN "nhom_su_co" SET NOT NULL;

CREATE INDEX "print_su_co_org_id_may_in_id_id_idx" ON "print_su_co"("org_id", "may_in_id", "id");
