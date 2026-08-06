-- Nhân viên được sai bot qua Zalo — thay env AI_AGENT_UID_NHANVIEN.
-- Spec: docs/superpowers/specs/2026-08-06-bang-nhan-vien-design.md
CREATE TABLE "agent_operators" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "zalo_uid" TEXT NOT NULL,
    "user_id" TEXT,
    "ten_goi" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_operators_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_operators_org_id_zalo_uid_key" ON "agent_operators"("org_id", "zalo_uid");
CREATE INDEX "agent_operators_org_id_enabled_idx" ON "agent_operators"("org_id", "enabled");

ALTER TABLE "agent_operators" ADD CONSTRAINT "agent_operators_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_operators" ADD CONSTRAINT "agent_operators_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
