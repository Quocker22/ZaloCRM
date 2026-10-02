-- 02/10/2026: CHO KHÁCH (docs/79 T5) — duyệt tài liệu RAG + mô tả SP cho đường khách của bot.
--   bot_cho_khach_danh_muc   danh mục MỚI NHẤT mỗi org bot đẩy lên (POST /api/public/cho-khach/danh-muc).
--   bot_tai_lieu_cho_khach   tài liệu "khách xem được" (không có dòng = không cho khách).
--   bot_mo_ta_duyet          mô tả SP đã duyệt, gắn với băm sha256 của mô tả đã chuẩn hoá (K2: đổi mô tả ⇒ hết hiệu lực).
--   bot_quyen_nhat_ky        nhận doi_tuong 'tai_lieu_cho_khach' | 'mo_ta_duyet' | 'danh_muc_cho_khach'.
-- Chỉ THÊM bảng + nới CHECK doi_tuong của nhật ký (bảng nhỏ — kiểm lại tức thì). Không đụng dữ liệu cũ.
SET lock_timeout = '5s';

CREATE TABLE "bot_cho_khach_danh_muc" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "phien_ban" TEXT NOT NULL,
    "tai_lieu" JSONB NOT NULL,
    "san_pham" JSONB NOT NULL,
    "luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_cho_khach_danh_muc_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bot_tai_lieu_cho_khach" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "tai_lieu_id" TEXT NOT NULL,
    "duyet_boi" TEXT NOT NULL,
    "luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_tai_lieu_cho_khach_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bot_mo_ta_duyet" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "mo_ta_bam" TEXT NOT NULL,
    "duyet_boi" TEXT NOT NULL,
    "luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_mo_ta_duyet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_cho_khach_danh_muc_org_id_key" ON "bot_cho_khach_danh_muc"("org_id");
CREATE UNIQUE INDEX "bot_tai_lieu_cho_khach_org_id_tai_lieu_id_key" ON "bot_tai_lieu_cho_khach"("org_id", "tai_lieu_id");
CREATE UNIQUE INDEX "bot_mo_ta_duyet_org_id_product_id_key" ON "bot_mo_ta_duyet"("org_id", "product_id");

ALTER TABLE "bot_cho_khach_danh_muc" ADD CONSTRAINT "bot_cho_khach_danh_muc_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_tai_lieu_cho_khach" ADD CONSTRAINT "bot_tai_lieu_cho_khach_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_mo_ta_duyet" ADD CONSTRAINT "bot_mo_ta_duyet_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lần chặn thứ hai (SQL tay): băm sai dạng không bao giờ tới bot.
ALTER TABLE "bot_mo_ta_duyet" ADD CONSTRAINT "bot_mo_ta_duyet_mo_ta_bam_check" CHECK ("mo_ta_bam" ~ '^[0-9a-f]{64}$');
ALTER TABLE "bot_mo_ta_duyet" ADD CONSTRAINT "bot_mo_ta_duyet_product_id_check" CHECK ("product_id" > 0);

ALTER TABLE "bot_quyen_nhat_ky" DROP CONSTRAINT "bot_quyen_nhat_ky_doi_tuong_check";
ALTER TABLE "bot_quyen_nhat_ky" ADD CONSTRAINT "bot_quyen_nhat_ky_doi_tuong_check"
    CHECK ("doi_tuong" IN ('nhom', 'nhan_vien', 'nick_crm', 'luat_thong_bao', 'ban_do_tin',
                           'tai_lieu_cho_khach', 'mo_ta_duyet', 'danh_muc_cho_khach'));
