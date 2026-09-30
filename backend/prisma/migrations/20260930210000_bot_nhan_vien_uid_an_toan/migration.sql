-- 30/09/2026: QUYỀN BOT (docs/77 §8b-an-toàn) — vá review bảo mật của "một NV = nhiều uid Zalo".
--
-- P0  globalId KHÔNG còn là bằng chứng tự nối: friends.zalo_global_id ghi được bởi MỌI user CRM (POST
--     /conversations/ensure-by-uid), backfill chép globalId qua các liên hệ đã gộp, và Zalo có globalId "giữ chỗ" dùng
--     chung ⇒ dòng nguon='global_id' bị GỠ (ghi nhật ký). Nếu có bằng chứng tin chung CHẶT thì vòng tự nối nối lại.
-- DANH TÍNH CHẮC (quyết định người điều phối, vòng 2): bằng chứng CHÍNH = globalId CRM tự đọc TRỰC TIẾP từ Zalo
--     (getUserInfo / findUser qua chính nick nhìn) lưu ở bảng HỆ THỐNG bot_quyen_danh_tinh — không route người dùng nào
--     ghi được. Hai uid (hai nick) là một người ⇔ globalId sống bằng nhau, khác rỗng, không "nhiễm" (một globalId mà
--     nhiều uid trên CÙNG nick mang ⇒ giữ chỗ ⇒ bỏ). Liên kết globalId tự áp cho MỌI vai (nguon 'zalo_global_id') + nhật
--     ký bằng chứng. Tin chung (cung_tin) chỉ còn là bằng chứng PHỤ ⇒ ĐỀ XUẤT (bảng bot_nhan_vien_uid_de_xuat) cho mọi
--     vai: chủ bấm "Nối" (⇒ nguon 'chu_xac_nhan') hoặc "Không phải". Dòng cung_tin cũ (mọi vai) ⇒ chuyển thành đề xuất.
--     Gỡ uid (DELETE /nhan-vien/:id/uid/:uid) và "Không phải" ghi bảng bot_nhan_vien_uid_tu_choi — vòng tự nối + đề xuất
--     tôn trọng bảng này (không nối lại).
-- Chỉ THÊM bảng/cột + chuyển dữ liệu; mỗi dòng chuyển/gỡ có một dòng nhật ký ai_id='tu_dong'.
SET lock_timeout = '5s';

CREATE TABLE "bot_nhan_vien_uid_de_xuat" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nhan_vien_id" TEXT NOT NULL,
    "zalo_account_id" TEXT,
    "zalo_uid" TEXT NOT NULL,
    "so_tin" INTEGER,
    "bang_chung" JSONB,
    "tao_luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cap_nhat_luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_nhan_vien_uid_de_xuat_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bot_nhan_vien_uid_de_xuat_zalo_uid_check" CHECK (length(btrim("zalo_uid")) > 0)
);
CREATE UNIQUE INDEX "bot_nhan_vien_uid_de_xuat_org_id_nhan_vien_id_zalo_uid_key"
  ON "bot_nhan_vien_uid_de_xuat"("org_id", "nhan_vien_id", "zalo_uid");
CREATE INDEX "bot_nhan_vien_uid_de_xuat_org_id_idx" ON "bot_nhan_vien_uid_de_xuat"("org_id");
ALTER TABLE "bot_nhan_vien_uid_de_xuat" ADD CONSTRAINT "bot_nhan_vien_uid_de_xuat_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_nhan_vien_uid_de_xuat" ADD CONSTRAINT "bot_nhan_vien_uid_de_xuat_nhan_vien_id_fkey"
  FOREIGN KEY ("nhan_vien_id") REFERENCES "bot_nhan_vien"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "bot_nhan_vien_uid_tu_choi" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nhan_vien_id" TEXT NOT NULL,
    "zalo_uid" TEXT NOT NULL,
    "ai_id" TEXT NOT NULL,
    "ly_do" TEXT,
    "tao_luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_nhan_vien_uid_tu_choi_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bot_nhan_vien_uid_tu_choi_org_id_nhan_vien_id_zalo_uid_key"
  ON "bot_nhan_vien_uid_tu_choi"("org_id", "nhan_vien_id", "zalo_uid");
ALTER TABLE "bot_nhan_vien_uid_tu_choi" ADD CONSTRAINT "bot_nhan_vien_uid_tu_choi_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_nhan_vien_uid_tu_choi" ADD CONSTRAINT "bot_nhan_vien_uid_tu_choi_nhan_vien_id_fkey"
  FOREIGN KEY ("nhan_vien_id") REFERENCES "bot_nhan_vien"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Bằng chứng của uid tự nối / chủ xác nhận (mã tin mẫu, số tin) — hiện trên trang + chép vào nhật ký.
ALTER TABLE "bot_nhan_vien_uid" ADD COLUMN "bang_chung" JSONB;

-- (1) uid tự nối của NV đặc quyền ⇒ đề xuất (không bao giờ là uid chính).
INSERT INTO "bot_nhan_vien_uid_de_xuat" ("id", "org_id", "nhan_vien_id", "zalo_account_id", "zalo_uid", "so_tin", "bang_chung")
SELECT gen_random_uuid()::text, u."org_id", u."nhan_vien_id", u."zalo_account_id", u."zalo_uid", NULL,
       jsonb_build_object('chuyen_tu', 'bot_nhan_vien_uid', 'nguon_cu', u."nguon")
FROM "bot_nhan_vien_uid" u JOIN "bot_nhan_vien" nv ON nv."id" = u."nhan_vien_id"
WHERE u."nguon" = 'cung_tin' AND u."zalo_uid" <> nv."zalo_uid"
ON CONFLICT ("org_id", "nhan_vien_id", "zalo_uid") DO NOTHING;

-- Nhật ký: mỗi NV một dòng — uid trước/sau + lý do.
INSERT INTO "bot_quyen_nhat_ky" ("id", "org_id", "ai_id", "doi_tuong", "doi_tuong_id", "truoc", "sau", "ly_do")
SELECT gen_random_uuid()::text, nv."org_id", 'tu_dong', 'nhan_vien', nv."id",
       jsonb_build_object('tenGoi', nv."ten_goi",
         'uids', (SELECT jsonb_agg(x."zalo_uid" ORDER BY x."zalo_uid") FROM "bot_nhan_vien_uid" x WHERE x."nhan_vien_id" = nv."id")),
       jsonb_build_object('tenGoi', nv."ten_goi",
         'uids', (SELECT coalesce(jsonb_agg(x."zalo_uid" ORDER BY x."zalo_uid"), '[]'::jsonb) FROM "bot_nhan_vien_uid" x
                  WHERE x."nhan_vien_id" = nv."id"
                    AND NOT (x."nguon" = 'global_id' AND x."zalo_uid" <> nv."zalo_uid")
                    AND NOT (x."nguon" = 'cung_tin' AND x."zalo_uid" <> nv."zalo_uid")),
         'goUids', (SELECT jsonb_agg(jsonb_build_object('zaloUid', x."zalo_uid", 'nguon', x."nguon") ORDER BY x."zalo_uid")
                    FROM "bot_nhan_vien_uid" x WHERE x."nhan_vien_id" = nv."id" AND x."zalo_uid" <> nv."zalo_uid"
                      AND x."nguon" IN ('global_id', 'cung_tin'))),
       'an toàn §8b: globalId đọc từ bảng người dùng ghi được không còn là bằng chứng (gỡ); uid nối bằng tin chung thành ĐỀ XUẤT chờ chủ nối'
FROM "bot_nhan_vien" nv
WHERE EXISTS (SELECT 1 FROM "bot_nhan_vien_uid" x WHERE x."nhan_vien_id" = nv."id" AND x."zalo_uid" <> nv."zalo_uid"
              AND x."nguon" IN ('global_id', 'cung_tin'));

-- (2) gỡ: global_id (bảng người dùng ghi được) + cung_tin (mọi vai — đã thành đề xuất). uid chính không bao giờ bị gỡ.
DELETE FROM "bot_nhan_vien_uid" u USING "bot_nhan_vien" nv
WHERE nv."id" = u."nhan_vien_id" AND u."zalo_uid" <> nv."zalo_uid" AND u."nguon" IN ('global_id', 'cung_tin');
UPDATE "bot_nhan_vien_uid" u SET "nguon" = 'chon'
FROM "bot_nhan_vien" nv WHERE nv."id" = u."nhan_vien_id" AND u."zalo_uid" = nv."zalo_uid" AND u."nguon" <> 'chon';

ALTER TABLE "bot_nhan_vien_uid" DROP CONSTRAINT "bot_nhan_vien_uid_nguon_check";
ALTER TABLE "bot_nhan_vien_uid" ADD CONSTRAINT "bot_nhan_vien_uid_nguon_check"
  CHECK ("nguon" IN ('chon', 'chu_xac_nhan', 'zalo_global_id'));

-- Số điện thoại Zalo (tuỳ chọn) của nhân viên — đường phụ: nick Y findUser(sđt) ⇒ uid nhìn từ Y, CHỈ nhận khi globalId sống
-- trùng globalId của uid chủ chọn.
ALTER TABLE "bot_nhan_vien" ADD COLUMN "so_dien_thoai" TEXT;

-- (0) BẢNG HỆ THỐNG danh tính Zalo đọc TRỰC TIẾP (getUserInfo/findUser qua nick `zalo_account_id`). Không route người dùng
--     nào ghi; `global_id` NULL = Zalo không trả globalId (không bao giờ là bằng chứng).
CREATE TABLE "bot_quyen_danh_tinh" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "zalo_uid" TEXT NOT NULL,
    "global_id" TEXT,
    "ten" TEXT,
    "nguon" TEXT NOT NULL DEFAULT 'zalo_api',
    "lay_luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "loi" TEXT,
    -- CHỈ dòng nick TỰ nhìn mình: SĐT thật của nick (getUserInfo(ownId).phoneNumber) — dùng findUser khi nick tắt.
    -- KHÔNG dùng zalo_accounts.phone (người gõ tay; staging gõ lẫn giữa các nick).
    "so_dien_thoai" TEXT,
    -- Dòng do findUser: SĐT đã tra (để đối chiếu với nhân viên có SĐT đó).
    "tim_theo_sdt" TEXT,

    CONSTRAINT "bot_quyen_danh_tinh_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bot_quyen_danh_tinh_nguon_check" CHECK ("nguon" IN ('zalo_api', 'zalo_find_user'))
);
CREATE UNIQUE INDEX "bot_quyen_danh_tinh_org_id_zalo_account_id_zalo_uid_key"
  ON "bot_quyen_danh_tinh"("org_id", "zalo_account_id", "zalo_uid");
CREATE INDEX "bot_quyen_danh_tinh_org_id_global_id_idx" ON "bot_quyen_danh_tinh"("org_id", "global_id");
ALTER TABLE "bot_quyen_danh_tinh" ADD CONSTRAINT "bot_quyen_danh_tinh_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_quyen_danh_tinh" ADD CONSTRAINT "bot_quyen_danh_tinh_zalo_account_id_fkey"
  FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- (3) NICK CRM nhìn từ nick khác (bổ sung của người điều phối sau vòng 3): nick X của org xuất hiện trong nhóm của nick Y
--     dưới một uid THEO NICK Y ⇒ trước đây bị đếm là người ngoài, mọi nhóm có hai nick mặc định Khách. HIỆU LỰC khi:
--     `zalo_global_id` (globalId sống của uid nhìn từ Y = globalId sống của X — findUser(X.phone) qua Y hoặc getUserInfo
--     thành viên nhóm của Y), `chu_chon` (chủ đánh dấu ở ngăn Thành viên) hoặc `chu_xac_nhan` (chủ nối đề xuất).
--     `cung_tin` (tin X tự gửi mà Y cũng ghi — luật tin chung chặt) CHỈ là ĐỀ XUẤT, không hiệu lực. Là "người công ty" cho
--     mặc định nhóm + nhãn thành viên + bot (nick_bot) — KHÔNG phải nhân viên ra lệnh bot. `tu_choi` = chủ đã gỡ.
CREATE TABLE "bot_nick_crm_uid" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "zalo_uid" TEXT NOT NULL,
    "nick_id" TEXT NOT NULL,
    "nguon" TEXT NOT NULL,
    "bang_chung" JSONB,
    "tu_choi" BOOLEAN NOT NULL DEFAULT false,
    "tao_luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cap_nhat_luc" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_nick_crm_uid_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bot_nick_crm_uid_nguon_check" CHECK ("nguon" IN ('zalo_global_id', 'chu_chon', 'chu_xac_nhan', 'cung_tin')),
    CONSTRAINT "bot_nick_crm_uid_zalo_uid_check" CHECK (length(btrim("zalo_uid")) > 0),
    CONSTRAINT "bot_nick_crm_uid_khac_nick_check" CHECK ("nick_id" <> "zalo_account_id")
);
CREATE UNIQUE INDEX "bot_nick_crm_uid_org_id_zalo_account_id_zalo_uid_key"
  ON "bot_nick_crm_uid"("org_id", "zalo_account_id", "zalo_uid");
CREATE INDEX "bot_nick_crm_uid_org_id_idx" ON "bot_nick_crm_uid"("org_id");
ALTER TABLE "bot_nick_crm_uid" ADD CONSTRAINT "bot_nick_crm_uid_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_nick_crm_uid" ADD CONSTRAINT "bot_nick_crm_uid_zalo_account_id_fkey"
  FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_nick_crm_uid" ADD CONSTRAINT "bot_nick_crm_uid_nick_id_fkey"
  FOREIGN KEY ("nick_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nhật ký nhận ra / đánh dấu / gỡ nick CRM: doi_tuong 'nick_crm', doi_tuong_id = id nick X.
ALTER TABLE "bot_quyen_nhat_ky" DROP CONSTRAINT "bot_quyen_nhat_ky_doi_tuong_check";
ALTER TABLE "bot_quyen_nhat_ky" ADD CONSTRAINT "bot_quyen_nhat_ky_doi_tuong_check"
  CHECK ("doi_tuong" IN ('nhom', 'nhan_vien', 'nick_crm'));
