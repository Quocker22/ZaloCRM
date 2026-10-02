-- 02/10/2026: THÔNG BÁO CHỦ ĐỘNG (docs/78 C2) — luật đích theo composer + ảnh chụp bản đồ tin của bot.
--   bot_luat_thong_bao  một dòng mỗi (org, composer): đích bản sao (jsonb mảng {kieu, gia_tri}), chế độ tat|bong|bat,
--                       điều kiện, gom, lịch, phien_ban (tăng mỗi lần sửa). Chủ sửa qua /api/v1/bot-quyen/luat-thong-bao
--                       (owner/admin, nhật ký bot_quyen_nhat_ky doi_tuong='luat_thong_bao'); bot đọc
--                       GET /api/public/bot-thong-bao/luat.
--   bot_ban_do_tin      ảnh chụp MỚI NHẤT mỗi org (bot POST /api/public/ban-do-tin): danh mục composer + số đếm.
-- Chỉ THÊM bảng + nới CHECK doi_tuong của nhật ký — không đụng dữ liệu cũ.
SET lock_timeout = '5s';

CREATE TABLE "bot_luat_thong_bao" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "loai" TEXT NOT NULL,
    "dich" JSONB NOT NULL DEFAULT '[]',
    "che_do" TEXT NOT NULL DEFAULT 'bong',
    "dieu_kien" JSONB NOT NULL DEFAULT '{}',
    "gom_giay" INTEGER NOT NULL DEFAULT 0,
    "lich" JSONB,
    "phien_ban" INTEGER NOT NULL DEFAULT 1,
    "sua_boi" TEXT,
    "sua_luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_luat_thong_bao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bot_ban_do_tin" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "phien_ban" TEXT NOT NULL,
    "composer" JSONB NOT NULL,
    "dem" JSONB NOT NULL,
    "luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_ban_do_tin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_luat_thong_bao_org_id_loai_key" ON "bot_luat_thong_bao"("org_id", "loai");
CREATE UNIQUE INDEX "bot_ban_do_tin_org_id_key" ON "bot_ban_do_tin"("org_id");

ALTER TABLE "bot_luat_thong_bao" ADD CONSTRAINT "bot_luat_thong_bao_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_ban_do_tin" ADD CONSTRAINT "bot_ban_do_tin_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lần chặn thứ hai (SQL tay / script): giá trị lạ không được tới bot. Kiểm ĐỦ (composer lạ, nhóm khách + nhạy cảm…)
-- nằm ở mã (bot-thong-bao-luat.ts) vì cần danh mục composer; ở đây chỉ hình dạng + `nhom_goc` không bao giờ là đích.
ALTER TABLE "bot_luat_thong_bao" ADD CONSTRAINT "bot_luat_thong_bao_che_do_check"
    CHECK ("che_do" IN ('tat', 'bong', 'bat'));
ALTER TABLE "bot_luat_thong_bao" ADD CONSTRAINT "bot_luat_thong_bao_gom_giay_check"
    CHECK ("gom_giay" >= 0 AND "gom_giay" <= 86400);
ALTER TABLE "bot_luat_thong_bao" ADD CONSTRAINT "bot_luat_thong_bao_dich_check"
    CHECK (jsonb_typeof("dich") = 'array' AND NOT ("dich" @> '[{"kieu": "nhom_goc"}]'::jsonb));
ALTER TABLE "bot_luat_thong_bao" ADD CONSTRAINT "bot_luat_thong_bao_dieu_kien_check"
    CHECK (jsonb_typeof("dieu_kien") = 'object');

-- Nhật ký quyền bot nhận thêm đối tượng `luat_thong_bao` (bảng nhỏ — kiểm lại CHECK trên toàn bảng là tức thì).
ALTER TABLE "bot_quyen_nhat_ky" DROP CONSTRAINT "bot_quyen_nhat_ky_doi_tuong_check";
ALTER TABLE "bot_quyen_nhat_ky" ADD CONSTRAINT "bot_quyen_nhat_ky_doi_tuong_check"
    CHECK ("doi_tuong" IN ('nhom', 'nhan_vien', 'nick_crm', 'luat_thong_bao'));
