-- Chào nhóm: cờ đã-chào (1 lần/nhóm) + blocklist nhóm
ALTER TABLE "conversations" ADD COLUMN "group_greeted_at" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN "bot_group_blocked" BOOLEAN NOT NULL DEFAULT false;
