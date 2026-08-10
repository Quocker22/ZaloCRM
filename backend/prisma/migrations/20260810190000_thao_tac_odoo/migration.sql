-- Bảng việc quen cho tool Odoo tổng quát (spec 2026-08-10).
-- IF NOT EXISTS: tạo tay trên prod TRƯỚC khi deploy code mới.
CREATE TABLE IF NOT EXISTS "thao_tac_odoo" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "ten" TEXT NOT NULL,
    "mo_ta" TEXT NOT NULL,
    "bang" TEXT NOT NULL,
    "viec" TEXT NOT NULL,
    "nut" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "ghi_chu" TEXT,
    CONSTRAINT "thao_tac_odoo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "thao_tac_odoo_org_id_ten_key" ON "thao_tac_odoo"("org_id", "ten");
CREATE INDEX IF NOT EXISTS "thao_tac_odoo_org_id_enabled_idx" ON "thao_tac_odoo"("org_id", "enabled");
