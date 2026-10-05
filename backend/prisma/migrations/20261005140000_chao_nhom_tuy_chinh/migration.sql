-- 05/10/2026: chủ tự sửa lời chào khi bot được thêm vào nhóm Zalo (Cài đặt › Trợ lý AI › Bot Zalo).
-- Chỉ THÊM 2 cột vào ai_configs (bảng 1 dòng/org). Mặc định bật + câu null = giữ y hành vi hiện tại.
SET lock_timeout = '5s';

ALTER TABLE "ai_configs"
    ADD COLUMN "chao_nhom_enabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "chao_nhom_text" TEXT;
