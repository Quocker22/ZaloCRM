-- 30/09/2026: QUYỀN BOT — MẶC ĐỊNH chức năng nhóm (docs/77 §8). Chủ: "trong nhóm toàn nhân viên thì mặc định là nhóm
-- nhân viên, có người không phải nhân viên thì mặc định nhóm khách". Bảng này giữ bản đọc danh sách thành viên của từng
-- hội thoại nhóm (getGroupInfo) để tính mặc định; chủ xếp tường minh (bot_nhom) luôn thắng. Chỉ THÊM bảng.
--
-- lock_timeout (review P2-10): FK tới "conversations" (bảng nóng) cần khoá SHARE ROW EXCLUSIVE trên nó — chờ quá 5 s thì
-- HỎNG (chạy lại lúc vắng) thay vì xếp hàng chặn mọi ghi tin nhắn phía sau. Bản này CHƯA lên server nào (nhánh chưa push).
SET lock_timeout = '5s';

-- CreateTable
CREATE TABLE "bot_nhom_danh_sach" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "uids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "day_du" BOOLEAN NOT NULL DEFAULT false,
    "doc_luc" TIMESTAMP(3),
    "can_doc_lai" BOOLEAN NOT NULL DEFAULT true,
    "danh_dau_luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "thu_luc" TIMESTAMP(3),
    "loi" TEXT,

    CONSTRAINT "bot_nhom_danh_sach_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_nhom_danh_sach_conversation_id_key" ON "bot_nhom_danh_sach"("conversation_id");

-- CreateIndex
CREATE INDEX "bot_nhom_danh_sach_org_id_idx" ON "bot_nhom_danh_sach"("org_id");

-- CreateIndex
CREATE INDEX "bot_nhom_danh_sach_zalo_account_id_idx" ON "bot_nhom_danh_sach"("zalo_account_id");

-- AddForeignKey
ALTER TABLE "bot_nhom_danh_sach" ADD CONSTRAINT "bot_nhom_danh_sach_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_nhom_danh_sach" ADD CONSTRAINT "bot_nhom_danh_sach_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
