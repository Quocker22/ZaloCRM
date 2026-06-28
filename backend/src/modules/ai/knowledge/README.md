# AI Knowledge Base (RAG)

RAG cho module AI: ingest tài liệu DN → embed → lưu (Postgres `Float[]`, KHÔNG pgvector) → khi có
tin khách, search KB + LLM sinh trả lời. Spec:
`docs/superpowers/specs/2026-06-28-ai-knowledge-base-rag-design.md`.

## Hai luồng

- **Luồng A — gợi ý cho sale** (`kbEnabled`): chèn tài liệu KB liên quan vào system prompt của
  virtual-chat-assistant. Sale duyệt gợi ý, không gửi tự động. An toàn.
- **Luồng B — auto-reply tin khách thật** (`autoReplyEnabled`): hook tin đến (`message-handler.ts`)
  → search KB → LLM → quyết định ở code: tự tin thì gửi thật qua `zaloOps.sendMessage`, không thì
  handoff (gắn tag). Quyết định gửi/handoff ở `ai-auto-reply-hook.ts` (đã test 10 case).

## Config (AiConfig, per-org)

| Field | Mặc định | Ý nghĩa |
|---|---|---|
| `kbEnabled` | false | Bật RAG làm giàu gợi ý (luồng A) |
| `autoReplyEnabled` | false | Bật tự gửi tin khách thật (luồng B) |
| `autoReplyConfidenceThreshold` | 0.7 | Ngưỡng tự tin để gửi |
| `autoReplyTagOnHandoff` | auto:can-sale | Tag gắn lên contact khi handoff |
| `embedProvider` / `embedModel` / `embedBaseUrl` | local / bge-m3 / http://localhost:11434/v1 | Embedding |

Cả hai cờ mặc định **TẮT** — bật thủ công khi DN sẵn sàng.

## Ingest (API)

```
POST /api/v1/ai/knowledge   { "title": "...", "content": "..." }   (auth: JWT/authMiddleware)
GET  /api/v1/ai/knowledge                                          (liệt kê document + số chunk)
DELETE /api/v1/ai/knowledge/:id
```

Cần embedding endpoint chạy. Local test:
```bash
ollama pull bge-m3        # embedding tiếng Việt tốt, 1024 chiều
# AiConfig: embedProvider=local, embedModel=bge-m3, embedBaseUrl=http://localhost:11434/v1
```

## Lưu vector

`KnowledgeChunk.embedding` là `Float[]` (Postgres `double precision[]`) — KHÔNG pgvector. Cosine tính
trong Node (`cosine.ts` + `rank.ts`). KB mỗi org nhỏ (vài trăm–vài nghìn chunk) → load RAM + cosine
đủ nhanh. Đổi embedding provider đổi số chiều → phải re-ingest toàn bộ KB (mỗi org chọn 1 provider).

## Migration & RLS

- Migration: `prisma/migrations/20260628120000_add_knowledge_base_and_ai_rag_config/` (2 bảng +
  7 cột AiConfig). Apply: `npx prisma migrate deploy` (sau khi review SQL).
- RLS: policy `tenant_isolation` cho `knowledge_documents` + `knowledge_chunks` đã thêm vào
  `prisma/rls/tenant-rls.sql` (apply theo quy trình rollout trong đầu file đó).

## Compliance

Auto-reply (luồng B) chạy trên tài khoản Zalo cá nhân (zca-js) → rủi ro **khóa nick**.
`autoReplyEnabled` mặc định TẮT; bật dần, theo dõi. Chỉ trả lời tin **inbound**. Quyết định gửi ở
code; mọi lỗi (LLM/embedding/send) → handoff, không gửi rác.

## Test

```bash
npx vitest run tests/ai/knowledge/    # 7 file, 35 test — logic thuần + DI mock, không cần DB
```
