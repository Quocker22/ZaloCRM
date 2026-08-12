-- Alias san pham hoc duoc (P1.3, 12/08) — xem schema SpAlias.
-- IF NOT EXISTS: cung quy trinh ai_guidelines — Dokploy khong tu migrate,
-- chay tay tren prod truoc/khi deploy.

CREATE TABLE IF NOT EXISTS "sp_alias" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "ten_goi" TEXT NOT NULL,
    "product_id" INTEGER NOT NULL,
    "ten_sp" TEXT NOT NULL,
    "dem_dung" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sp_alias_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "sp_alias_org_id_ten_goi_key"
    ON "sp_alias"("org_id", "ten_goi");
