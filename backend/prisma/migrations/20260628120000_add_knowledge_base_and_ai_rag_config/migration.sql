-- RAG Knowledge Base 2026-06-28
-- Chỉ thêm phần KB: 2 bảng + 7 cột AiConfig. KHÔNG đụng bảng khác.
-- Vector lưu double precision[] (Float[]) — KHÔNG pgvector.

-- AiConfig: cấu hình RAG
ALTER TABLE "ai_configs"
  ADD COLUMN "kb_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "auto_reply_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "auto_reply_confidence_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  ADD COLUMN "auto_reply_tag_on_handoff" TEXT NOT NULL DEFAULT 'auto:can-sale',
  ADD COLUMN "embed_provider" TEXT NOT NULL DEFAULT 'local',
  ADD COLUMN "embed_model" TEXT NOT NULL DEFAULT 'bge-m3',
  ADD COLUMN "embed_base_url" TEXT NOT NULL DEFAULT 'http://localhost:11434/v1';

-- knowledge_documents
CREATE TABLE "knowledge_documents" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'upload',
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "knowledge_documents_org_id_idx" ON "knowledge_documents"("org_id");

-- knowledge_chunks
CREATE TABLE "knowledge_chunks" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "ord" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "embedding" DOUBLE PRECISION[],
  "embed_provider" TEXT NOT NULL,
  "embed_model" TEXT NOT NULL,
  "embed_dim" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "knowledge_chunks_org_id_idx" ON "knowledge_chunks"("org_id");
CREATE INDEX "knowledge_chunks_document_id_idx" ON "knowledge_chunks"("document_id");

-- Foreign keys
ALTER TABLE "knowledge_documents"
  ADD CONSTRAINT "knowledge_documents_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_chunks"
  ADD CONSTRAINT "knowledge_chunks_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_chunks"
  ADD CONSTRAINT "knowledge_chunks_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
