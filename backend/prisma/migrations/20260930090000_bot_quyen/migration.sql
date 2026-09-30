-- 30/09/2026: QUYỀN BOT (docs/77 §3.1) — ZaloCRM giữ dữ liệu quyền của bot Zalo LEDNELIA:
--   bot_nhom           chức năng của từng hội thoại NHÓM với bot (admin|sales|kho|ke_toan|khach);
--                      nhóm KHÔNG có dòng = "chưa xếp loại" ⇒ bot im.
--   bot_nhan_vien      vai (admin|sales|kho|ke_toan|cong_ty) + trạng thái (hoat_dong|khoa|nghi) của
--                      từng Zalo nhân viên, khoá (org_id, zalo_uid); không xoá cứng.
--   bot_quyen_nhat_ky  nhật ký CHỈ THÊM: ai, lúc, trước → sau (jsonb), lý do.
-- Bot đọc qua GET /api/public/bot-quyen (khoá x-api-key), không ghi ngược. Chỉ owner/admin CRM
-- sửa qua /api/v1/bot-quyen (bot-quyen-routes.ts). Chỉ THÊM bảng — không đụng bảng cũ.
--
-- CHECK trên các cột enum: bot đồng bộ theo đúng các giá trị này (hợp đồng công khai) — giá trị lạ
-- lọt vào DB bằng đường khác (SQL tay, script) phải bị chặn ở đây chứ không được tới bot.

-- CreateTable
CREATE TABLE "bot_nhom" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "chuc_nang" TEXT NOT NULL,
    "ten_dang_ky" TEXT NOT NULL DEFAULT '',
    "ghi_chu" TEXT,
    "cap_nhat_boi_id" TEXT,
    "cap_nhat_luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_nhom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_nhan_vien" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "zalo_uid" TEXT NOT NULL,
    "ten_goi" TEXT NOT NULL,
    "vai" TEXT NOT NULL,
    "trang_thai" TEXT NOT NULL DEFAULT 'hoat_dong',
    "user_id" TEXT,
    "ghi_chu" TEXT,
    "cap_nhat_boi_id" TEXT,
    "cap_nhat_luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_nhan_vien_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_quyen_nhat_ky" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "ai_id" TEXT NOT NULL,
    "luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doi_tuong" TEXT NOT NULL,
    "doi_tuong_id" TEXT NOT NULL,
    "truoc" JSONB,
    "sau" JSONB,
    "ly_do" TEXT,

    CONSTRAINT "bot_quyen_nhat_ky_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_nhom_conversation_id_key" ON "bot_nhom"("conversation_id");

-- CreateIndex
CREATE INDEX "bot_nhom_org_id_idx" ON "bot_nhom"("org_id");

-- CreateIndex
CREATE INDEX "bot_nhan_vien_org_id_vai_trang_thai_idx" ON "bot_nhan_vien"("org_id", "vai", "trang_thai");

-- CreateIndex
CREATE UNIQUE INDEX "bot_nhan_vien_org_id_zalo_uid_key" ON "bot_nhan_vien"("org_id", "zalo_uid");

-- CreateIndex
CREATE INDEX "bot_quyen_nhat_ky_org_id_luc_idx" ON "bot_quyen_nhat_ky"("org_id", "luc" DESC);

-- CreateIndex
CREATE INDEX "bot_quyen_nhat_ky_org_id_doi_tuong_doi_tuong_id_idx" ON "bot_quyen_nhat_ky"("org_id", "doi_tuong", "doi_tuong_id");

-- AddForeignKey
ALTER TABLE "bot_nhom" ADD CONSTRAINT "bot_nhom_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_nhom" ADD CONSTRAINT "bot_nhom_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_nhan_vien" ADD CONSTRAINT "bot_nhan_vien_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_nhan_vien" ADD CONSTRAINT "bot_nhan_vien_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_quyen_nhat_ky" ADD CONSTRAINT "bot_quyen_nhat_ky_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CHECK enum (Prisma không quản CHECK ⇒ không sinh drift).
ALTER TABLE "bot_nhom" ADD CONSTRAINT "bot_nhom_chuc_nang_check"
    CHECK ("chuc_nang" IN ('admin', 'sales', 'kho', 'ke_toan', 'khach'));
ALTER TABLE "bot_nhan_vien" ADD CONSTRAINT "bot_nhan_vien_vai_check"
    CHECK ("vai" IN ('admin', 'sales', 'kho', 'ke_toan', 'cong_ty'));
ALTER TABLE "bot_nhan_vien" ADD CONSTRAINT "bot_nhan_vien_trang_thai_check"
    CHECK ("trang_thai" IN ('hoat_dong', 'khoa', 'nghi'));
ALTER TABLE "bot_quyen_nhat_ky" ADD CONSTRAINT "bot_quyen_nhat_ky_doi_tuong_check"
    CHECK ("doi_tuong" IN ('nhom', 'nhan_vien'));
