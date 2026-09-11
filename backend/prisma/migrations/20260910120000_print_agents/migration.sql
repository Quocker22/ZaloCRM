-- 10/09/2026: nhiều máy in theo chi nhánh (gen token ZaloCRM).
-- print_agents = nguồn định tuyến token->máy->kho phục vụ. Seed máy HN (đọc
-- AI_MAY_IN_AGENT_TOKEN) làm ở runtime bằng script scripts/seed-print-agent-hn.ts,
-- KHÔNG seed trong SQL (env không có trong SQL).
CREATE TABLE IF NOT EXISTS "print_agents" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "ten" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "warehouse_ids" INTEGER[] NOT NULL DEFAULT '{}',
  "la_mac_dinh" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "print_agents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "print_agents_token_key" ON "print_agents"("token");
CREATE INDEX IF NOT EXISTS "print_agents_org_id_idx" ON "print_agents"("org_id");

ALTER TABLE "print_jobs" ADD COLUMN IF NOT EXISTS "agent_token" TEXT;
