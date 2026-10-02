-- 02/10/2026: THỨ TỰ ỔN ĐỊNH + KHỬ TRÙNG GHI BÙ cho print_su_co (docs/78 Codex CRM+UI v2 #2, #3).
--   thu_tu  bigint — µs lúc CRM NHẬN sự cố, đơn điệu (su-kien-in.ts taoHangThuLaiSuCo). Truy vấn mở/đóng sự cố xếp theo
--           (luc, thu_tu) — KHÔNG theo id: dòng ghi bù (DB chập rồi sống lại / khởi động lại) có id lớn hơn mà xảy ra trước.
--           Mặc định = µs của clock_timestamp() cho writer không biết cột (SQL tay, image lùi) — cùng thang với mã.
--   ma_ghi  text UNIQUE — uuid đóng dấu lúc nhận; hàng thử lại ghi trước ra đĩa nên sau khởi động lại có thể ghi bù một mục
--           ĐÃ commit ⇒ trùng ma_ghi = đã có (ghiSuCoIn trả `trung`). NULL (writer cũ) không ràng buộc.
-- Bảng mới từ 20261002090000 (chưa lên môi trường nào) — điền lại rồi NOT NULL là tức thì.
SET lock_timeout = '5s';

ALTER TABLE "print_su_co" ADD COLUMN "thu_tu" BIGINT, ADD COLUMN "ma_ghi" TEXT;
UPDATE "print_su_co" SET "thu_tu" = (EXTRACT(EPOCH FROM "luc") * 1000000)::BIGINT WHERE "thu_tu" IS NULL;
ALTER TABLE "print_su_co" ALTER COLUMN "thu_tu" SET NOT NULL,
  ALTER COLUMN "thu_tu" SET DEFAULT ((EXTRACT(EPOCH FROM clock_timestamp()) * (1000000)::numeric))::BIGINT;

CREATE UNIQUE INDEX "print_su_co_ma_ghi_key" ON "print_su_co"("ma_ghi");
CREATE INDEX "print_su_co_org_id_may_in_id_nhom_su_co_luc_thu_tu_idx" ON "print_su_co"("org_id", "may_in_id", "nhom_su_co", "luc", "thu_tu");
