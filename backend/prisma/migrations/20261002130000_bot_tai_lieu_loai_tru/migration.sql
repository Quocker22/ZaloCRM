-- 02/10/2026 tối: CHO KHÁCH đổi ngữ nghĩa theo chủ chốt (docs/79 §sửa-RAG) — thông số kỹ thuật ai hỏi cũng trả lời được ⇒ đường
-- khách dùng MỌI tài liệu kho tri thức CRM, TRỪ tài liệu admin loại trừ (bảng này). Duyệt cũ (bot_tai_lieu_cho_khach) giữ nguyên
-- để đối chiếu, không còn quyết định tìm. Lưới bỏ dòng giá/SĐT/link vẫn áp cho mọi đoạn trả khách.
--   bot_tai_lieu_loai_tru   một dòng = tài liệu KHÔNG dùng để trả lời khách (không có dòng = dùng).
--   bot_quyen_nhat_ky       nhận thêm doi_tuong 'tai_lieu_loai_tru'.
-- Chỉ THÊM bảng + nới CHECK doi_tuong (bảng nhỏ). Không đụng dữ liệu cũ.
SET lock_timeout = '5s';

CREATE TABLE "bot_tai_lieu_loai_tru" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "tai_lieu_id" TEXT NOT NULL,
    "ly_do" TEXT,
    "boi" TEXT NOT NULL,
    "luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bot_tai_lieu_loai_tru_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bot_tai_lieu_loai_tru_org_id_tai_lieu_id_key" ON "bot_tai_lieu_loai_tru"("org_id", "tai_lieu_id");
ALTER TABLE "bot_tai_lieu_loai_tru" ADD CONSTRAINT "bot_tai_lieu_loai_tru_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bot_quyen_nhat_ky" DROP CONSTRAINT "bot_quyen_nhat_ky_doi_tuong_check";
ALTER TABLE "bot_quyen_nhat_ky" ADD CONSTRAINT "bot_quyen_nhat_ky_doi_tuong_check"
    CHECK ("doi_tuong" IN ('nhom', 'nhan_vien', 'nick_crm', 'luat_thong_bao', 'ban_do_tin',
                           'tai_lieu_cho_khach', 'mo_ta_duyet', 'danh_muc_cho_khach', 'tai_lieu_loai_tru'));
