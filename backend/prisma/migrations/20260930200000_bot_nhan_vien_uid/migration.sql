-- 30/09/2026: QUYỀN BOT (docs/77 §8b) — MỘT nhân viên, NHIỀU uid Zalo (mỗi nick nhìn một uid).
--
-- Vì sao: Zalo cấp uid KHÁC NHAU cho cùng một người ở mỗi nick (và cả mã nhóm cũng khác theo nick). Bản trước khoá
-- nhân viên theo MỘT uid ⇒ "Trần Hưng" gán bằng uid thấy ở nick Cẩm Loan (3395858500519725514) thì bot — chạy trên nick
-- Vận Tải Minh Thức, thấy anh là 3835588809400259343 — KHÔNG nhận ra; dòng của nick kia vẫn nằm trong "Chờ gán".
--
-- Chỉ THÊM bảng. Dòng cũ: mỗi bot_nhan_vien có một dòng uid chính (nguồn 'chon', nick chưa biết). uid của CÙNG người ở
-- nick khác do ứng dụng tự bổ sung (bot-quyen-cung-nguoi.ts: cùng mã tin nhắn Zalo trong nhóm chung / cùng globalId) ở
-- lần mở trang Nhân viên đầu tiên hoặc vòng đối soát 30 phút — một chỗ luật, không chép luật vào SQL.
SET lock_timeout = '5s';

CREATE TABLE "bot_nhan_vien_uid" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nhan_vien_id" TEXT NOT NULL,
    "zalo_account_id" TEXT,
    "zalo_uid" TEXT NOT NULL,
    "nguon" TEXT NOT NULL,
    "tao_luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_nhan_vien_uid_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bot_nhan_vien_uid_nguon_check" CHECK ("nguon" IN ('chon', 'cung_tin', 'global_id')),
    CONSTRAINT "bot_nhan_vien_uid_zalo_uid_check" CHECK (length(btrim("zalo_uid")) > 0)
);

CREATE UNIQUE INDEX "bot_nhan_vien_uid_org_id_zalo_uid_key" ON "bot_nhan_vien_uid"("org_id", "zalo_uid");
CREATE INDEX "bot_nhan_vien_uid_nhan_vien_id_idx" ON "bot_nhan_vien_uid"("nhan_vien_id");

ALTER TABLE "bot_nhan_vien_uid" ADD CONSTRAINT "bot_nhan_vien_uid_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_nhan_vien_uid" ADD CONSTRAINT "bot_nhan_vien_uid_nhan_vien_id_fkey"
  FOREIGN KEY ("nhan_vien_id") REFERENCES "bot_nhan_vien"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- uid chính của mọi nhân viên đã có.
INSERT INTO "bot_nhan_vien_uid" ("id", "org_id", "nhan_vien_id", "zalo_account_id", "zalo_uid", "nguon", "tao_luc")
SELECT gen_random_uuid()::text, nv."org_id", nv."id", NULL, nv."zalo_uid", 'chon', nv."cap_nhat_luc"
FROM "bot_nhan_vien" nv
ON CONFLICT ("org_id", "zalo_uid") DO NOTHING;
