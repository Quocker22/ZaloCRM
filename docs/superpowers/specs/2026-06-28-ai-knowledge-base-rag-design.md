# Spec: RAG Knowledge Base trong module AI ZaloCRM

**Ngày:** 2026-06-28
**Phạm vi:** Mở rộng module AI có sẵn (`backend/src/modules/ai/`) để thêm knowledge base + RAG.
Cho phép AI trả lời khách dựa trên tài liệu của doanh nghiệp (DN): (A) làm giàu gợi ý cho sale,
và (B) tự động trả lời tin khách thật qua Zalo — có cờ bật/tắt.

---

## 1. Mục tiêu & bối cảnh

ZaloCRM fork đã có module AI khá hoàn chỉnh: multi-provider LLM (Anthropic/Gemini/OpenAI/Qwen/Kimi),
virtual-chat-assistant (gợi ý + trích entity), reply-draft/summary/sentiment, quota per-org. **Thiếu
đúng một mảnh: knowledge base / RAG** — đúng phần UI đã chừa chỗ ("Đang phát triển — kết nối
knowledge base"). Spec này bổ sung mảnh đó.

Thiết kế RAG đã được **prototype và chứng minh** ở một bot Go riêng (`gmaps-scraper` repo,
`internal/bot/`), test thật với data LEDNELIA (1357 sản phẩm → 420 chunks, embedding bge-m3 local,
gemma2/qwen3 trả lời). Bài học: model đủ mạnh (gemma2:9b, qwen3:32b) tuân thủ "chỉ dựa trên tài
liệu" và handoff đúng khi hỏi giá; model yếu (qwen3:8b) bịa giá → **ngưỡng confidence + handoff là
lớp bảo vệ bắt buộc**. Spec này hiện thực lại thiết kế đó bằng TypeScript trong ngăn xếp ZaloCRM.

### 1.1 Vì sao làm trong ZaloCRM thay vì bot Go riêng

- ZaloCRM đã có phần khó: nhận tin (zca-js listener), multi-LLM, quota, UI, socket, RLS per-org.
- ZaloCRM gọi `sendMessage()` in-process → **gửi tin Zalo thật được** (bot Go cắm-ngoài vướng:
  public API không trả `zaloAccountId` cần để gửi). In-process truy cập thẳng Prisma → có đủ
  `conversation.zaloAccountId` + `externalThreadId`.
- Tránh hai hệ AI song song (double-reply, đồng bộ KB hai nơi).

### 1.2 Out of scope

- pgvector / vector database (xem §3 — KB nhỏ, cosine in-app đủ).
- UI upload KB (làm sau MVP; MVP dùng API endpoint).
- Multi-modal (ảnh/file PDF) — chỉ text.
- Dùng dữ liệu scrape làm KB (sau MVP).

---

## 2. Kiến trúc tổng thể

Mở rộng module `ai/`, thêm khối `knowledge/`. KHÔNG service mới.

```
backend/src/modules/ai/
  knowledge/                        ← MỚI
    knowledge-service.ts            # ingest (chunk→embed→lưu) + search (embed query+cosine top-K)
    knowledge-routes.ts             # POST/GET/DELETE /api/v1/ai/knowledge
    embedding.ts                    # generateEmbedding(provider, model, text) — interface đổi provider
    cosine.ts                       # cosine similarity (port từ bot Go)
    providers/
      embedding-openai.ts           # OpenAI-compatible /embeddings (Ollama local + OpenAI + Qwen)
      embedding-gemini.ts           # Gemini embedContent
  ai-virtual-chat-service.ts        ← SỬA: chèn KB context vào buildUserPrompt (luồng A)
  ai-auto-reply-hook.ts             ← MỚI: hook tin đến thật → RAG → gửi/gợi ý (luồng B)
  provider-registry.ts              ← SỬA nhẹ: getEmbeddingProvider (key/baseUrl per-org)

backend/prisma/schema.prisma        ← THÊM: KnowledgeDocument, KnowledgeChunk + quan hệ Organization
backend/prisma/rls/tenant-rls.sql   ← THÊM: RLS policy cho 2 bảng mới (theo pattern có sẵn)
backend/src/modules/chat/message-handler.ts  ← SỬA: gọi ai-auto-reply-hook sau runAutomationRules
```

**Bốn khối, trách nhiệm tách bạch:**

1. **`embedding.ts` (+providers)** — text → vector. Interface `embed(opts)`; 2 backend
   (OpenAI-compat cho Ollama/OpenAI/Qwen, Gemini). Đổi provider qua config, như `generateText`.
2. **`knowledge-service.ts`** — ingest (vòng đời GHI) + search (vòng đời ĐỌC). Cosine trong Node.
3. **`knowledge-routes.ts`** — API nạp/liệt kê/xóa tài liệu (auth org). MVP không UI.
4. **`ai-auto-reply-hook.ts`** — tích hợp luồng tin đến: search KB → `generateText()` → quyết định
   (code TS) gửi thật / handoff.

**Tái dùng tối đa:** `generateText()` (`ai-service.ts`), provider-registry, AiConfig, AiSuggestion,
pattern orgId/RLS, pattern route AI, `sendMessage()` (`shared/zalo-operations.ts`).
**KHÔNG đụng:** Docker, DB image, pgvector, RLS core.

---

## 3. Data model & lưu vector

### 3.1 Hai model Prisma mới (convention ZaloCRM: orgId, snake_case @@map, timestamps)

```prisma
model KnowledgeDocument {
  id        String   @id @default(cuid())
  orgId     String   @map("org_id")
  title     String
  source    String   @default("upload")   // 'upload' | 'manual' | 'scrape'
  content   String   @db.Text             // bản gốc (re-chunk được)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  org    Organization     @relation(fields: [orgId], references: [id], onDelete: Cascade)
  chunks KnowledgeChunk[]

  @@index([orgId])
  @@map("knowledge_documents")
}

model KnowledgeChunk {
  id            String   @id @default(cuid())
  orgId         String   @map("org_id")
  documentId    String   @map("document_id")
  ord           Int                              // thứ tự đoạn trong tài liệu
  content       String   @db.Text
  embedding     Float[]                          // double precision[] — KHÔNG cần pgvector
  embedProvider String   @map("embed_provider")  // 'local' | 'gemini' | 'openai'
  embedModel    String   @map("embed_model")
  embedDim      Int      @map("embed_dim")        // số chiều — phát hiện lệch khi đổi provider
  createdAt     DateTime @default(now()) @map("created_at")

  org      Organization      @relation(fields: [orgId], references: [id], onDelete: Cascade)
  document KnowledgeDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([orgId])
  @@index([documentId])
  @@map("knowledge_chunks")
}
```

Thêm quan hệ ngược trên `model Organization`: `knowledgeDocuments KnowledgeDocument[]` +
`knowledgeChunks KnowledgeChunk[]`.

### 3.2 Lưu vector: `Float[]` (Postgres `double precision[]`), KHÔNG pgvector

**Lý do:** Postgres ZaloCRM là `postgres:16-alpine` — không có pgvector; đổi image = rủi ro/downtime
trên DB production đang chạy thật + phải kiểm lại RLS. KB mỗi DN nhỏ (LEDNELIA ~420 chunks; cho lớn
gấp 10 vẫn ~4000 chunk × 1536 ≈ 24MB) → load vào RAM tính cosine **vài chục ms**, không cảm nhận
được. Prisma hỗ trợ `Float[]` native (Postgres array) — không extension, đọc/ghi qua Prisma trực
tiếp. pgvector chỉ đáng khi KB hàng trăm nghìn–triệu vector — YAGNI ở đây.

**Search:** `prisma.knowledgeChunk.findMany({ where: { orgId } })` → cosine trong Node → top-K.
**An toàn đổi provider:** search lọc bỏ chunk khác `embedDim` với query vector (cosine length-mismatch
→ 0). Đổi embedding provider buộc re-ingest (số chiều khác); mỗi org chọn 1 provider cố định.

### 3.3 Không thêm bảng usage-log

ZaloCRM đã có `AiSuggestion`. Auto-reply RAG ghi vào đó (type `auto_reply_rag`) — audit + idempotency
(theo `messageId`). Tái dùng thay vì thêm bảng. YAGNI.

### 3.4 Migration

`npm run db:migrate` (Prisma migrate dev) tạo 2 bảng + quan hệ. Không `CREATE EXTENSION`. Thêm RLS
policy cho `knowledge_documents` + `knowledge_chunks` theo pattern `tenant-rls.sql` có sẵn (org-scoped).

---

## 4. Embedding (provider-agnostic, mặc định local)

Interface trong `embedding.ts`:
```ts
type EmbedProvider = 'local' | 'openai' | 'gemini' | 'qwen';
async function generateEmbedding(opts: {
  provider: EmbedProvider; model: string; apiKey?: string; baseUrl?: string; texts: string[];
}): Promise<number[][]>;   // mỗi text → vector. Batch cho ingest; search gọi với mảng 1 phần tử.
```

- **local / openai / qwen** → `embedding-openai.ts`: POST `{baseUrl}/embeddings`, body `{input, model}`,
  parse `data[].embedding`. Ollama local (`http://host:11434/v1`, model `bge-m3`, không cần key) và
  OpenAI (`text-embedding-3-small`) dùng chung shape.
- **gemini** → `embedding-gemini.ts`: POST `embedContent`, parse `embedding.values`.
- Cấu hình per-org qua provider-registry (key mã hóa + baseUrl) như LLM provider hiện có.
- **Mặc định MVP: local bge-m3** (đã test, miễn phí, dữ liệu không ra ngoài). Đổi sang Gemini/OpenAI
  bằng config, không sửa code.

---

## 5. Luồng xử lý

### 5.1 Luồng A — làm giàu gợi ý cho sale (mặc định, an toàn)

`ai-virtual-chat-service.ts` đã gọi `buildUserPrompt()`. Chèn KB (search bằng tin KHÁCH gần nhất —
tin contact, không phải tin sale; nếu virtual-chat hiện build từ tin sale thì lấy tin contact cuối
trong lịch sử làm query):
```
buildContext() → knowledgeService.search(orgId, câu hỏi khách) → top-K chunk
  → buildUserPrompt ráp thêm khối, đặt TRƯỚC <latest_sale_message>:
    <knowledge_base>
    {các chunk KB liên quan}
    </knowledge_base>
  → generateText() (tái dùng) sinh gợi ý → hiện cho sale (KHÔNG gửi khách, như hiện tại)
```
Chỉ bật khi `kbEnabled=true`. Thay đổi tối thiểu, không đụng hành vi gửi.

### 5.2 Luồng B — auto-reply tin khách thật (bật/tắt qua config)

File mới `ai-auto-reply-hook.ts`, cắm vào `message-handler.ts` **sau `runAutomationRules`**
(fire-and-forget, không block luồng nhận tin):

```
tin khách đến (handleIncomingMessage, !isSelf)
  → void onIncomingMessageHook(orgId, conversation, message).catch(...)

onIncomingMessageHook:
  1. LỌC: autoReplyEnabled=false? hội thoại isVirtual? đã có tag handoff? tin rỗng?
          messageId đã xử lý (AiSuggestion)? → bỏ qua
  2. SEARCH KB: knowledgeService.search(orgId, message.content) → top-K
  3. SINH: generateText(system + KB + lịch sử N tin, câu hỏi)
           ép JSON {reply, confidence (0..1), needs_human, reason}
  4. QUYẾT ĐỊNH (code TS — KHÔNG để LLM tự gửi):
     - confidence >= autoReplyConfidenceThreshold && !needs_human:
         → sendMessage(conv.zaloAccountId, conv.externalThreadId, threadType, { msg: reply })  ← GỬI THẬT
         → lưu Message (isLocal=false, senderType='ai_assistant', sentVia='automation')
     - ngược lại → HANDOFF: gắn tag autoReplyTagOnHandoff lên contact + KHÔNG gửi
  5. Ghi AiSuggestion (mọi nhánh): type='auto_reply_rag', content=reply, confidence, messageId (idempotency)
```

### 5.3 Năm điểm thiết kế then chốt

1. **Quyết định ở code TS, không phải LLM** (như bot Go). LLM chỉ đề xuất confidence/needs_human;
   code gọi `sendMessage`. Ngưỡng + cờ trong AiConfig.
2. **Chống bịa (bài học LEDNELIA):** system prompt siết "CHỈ dựa trên TÀI LIỆU; hỏi giá/ngoài KB →
   needs_human=true". Ngưỡng confidence chặn model yếu bịa.
3. **Idempotency:** AiSuggestion theo `messageId` → không trả lời 2 lần. Webhook/listener có thể lặp.
4. **Chống double-reply với sale:** trước auto-send, check hội thoại có tag handoff / sale vừa
   trả lời (senderType='self' gần nhất) → bot lùi.
5. **Lỗi → im lặng + handoff:** LLM/embedding/sendMessage lỗi → không gửi rác, lưu gợi ý cho sale.

### 5.4 Bật gửi Zalo thật

`sendMessage(accountId, threadId, threadType, { msg }, io?)` (`shared/zalo-operations.ts`). Tham số:
`conv.zaloAccountId`, `conv.externalThreadId`, `conv.threadType` ('user'→0 / 'group'→1) — lấy thẳng
từ Prisma (in-process). Đây là điểm bot Go cắm-ngoài KHÔNG làm được (public API thiếu zaloAccountId).

---

## 6. Config mới (trong AiConfig — tái dùng pattern có sẵn)

| Field | Mặc định | Ý nghĩa |
|---|---|---|
| `kbEnabled` | `false` | Bật RAG làm giàu gợi ý (luồng A) |
| `autoReplyEnabled` | `false` | Bật auto-send tin khách thật (luồng B) |
| `autoReplyConfidenceThreshold` | `0.7` | Ngưỡng tự tin để gửi |
| `autoReplyTagOnHandoff` | `auto:can-sale` | Tag gắn lên contact khi handoff |
| `embedProvider` | `local` | `local` \| `openai` \| `gemini` \| `qwen` |
| `embedModel` | `bge-m3` | Model embedding |
| `embedBaseUrl` | `http://localhost:11434/v1` | Endpoint embedding (local) |

Cả hai cờ mặc định TẮT — bật thủ công khi DN sẵn sàng.

---

## 7. API endpoints (MVP, auth org như route AI khác)

| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/v1/ai/knowledge` | Ingest tài liệu: body `{title, source?, content}` → chunk + embed + lưu → trả `{documentId, chunks}` |
| GET | `/api/v1/ai/knowledge` | Liệt kê documents của org (id, title, source, số chunk, createdAt) |
| DELETE | `/api/v1/ai/knowledge/:id` | Xóa document + chunks (cascade) |

---

## 8. Error handling (lỗi → im lặng + handoff, không gửi rác)

| Tình huống | Xử lý |
|---|---|
| Embedding lỗi lúc search | Bỏ RAG, gợi ý với KB rỗng → confidence thấp → handoff. Không crash. |
| Embedding lỗi lúc ingest | Trả lỗi cho API caller; không lưu nửa vời (transaction). |
| LLM lỗi/timeout | Hook catch hết → handoff (lưu AiSuggestion), không gửi. |
| `sendMessage` lỗi | Log, KHÔNG retry mù (tránh gửi trùng); lưu gợi ý cho sale. |
| LLM trả JSON sai | Parse khoan dung (trích `{...}`); hỏng → không tự tin → handoff. |
| Chunk lệch embedDim | Search bỏ qua; cảnh báo cần re-ingest. |
| Hook làm chậm | fire-and-forget — không bao giờ block handleIncomingMessage. |

---

## 9. Testing (pattern test backend ZaloCRM)

- `knowledge-service`: chunk đúng; ingest lưu đúng số chunk + metadata; search top-K đúng thứ tự
  cosine (vector giả định).
- `embedding`: mock HTTP (Ollama/Gemini) → parse vector; xử lý lỗi.
- `cosine`: round-trip, orthogonal, length-mismatch (port từ bot Go).
- `ai-auto-reply-hook`: mock LLM + sendMessage + prisma → **ma trận quyết định** (confidence
  cao+autoSend→gửi; needs_human→handoff; bot tắt→bỏ; virtual→bỏ; đã có sale→bỏ; dup messageId→bỏ;
  lỗi→handoff). Test quan trọng nhất.
- `knowledge-routes`: ingest/list/delete + auth org.
- E2E thủ công (gated): ingest catalog LEDNELIA → search → gemma2 local → kiểm tra reply.

---

## 10. Compliance (CRITICAL)

- Auto-send chạy trên **tài khoản Zalo cá nhân (zca-js)** → rủi ro khóa nick. `autoReplyEnabled`
  mặc định TẮT; bật dần, theo dõi tỉ lệ handoff/phản hồi.
- Chỉ trả lời tin khách **chủ động nhắn đến** (inbound). Không tự gửi chủ động.
- ND 91/2020 + dữ liệu cá nhân: review trước khi chạy diện rộng. Không phải tư vấn pháp lý.

---

## 11. Phạm vi MVP

**Có:** 2 model KB + migration + RLS · embedding provider (local mặc định, đổi được) · cosine ·
ingest/list/delete API · search · chèn KB vào gợi ý (luồng A) · auto-reply hook + cờ bật/tắt
(luồng B) · config AiConfig · tests (đặc biệt ma trận quyết định).

**Sau MVP:** UI upload KB trong Settings AI (Vue) · dashboard tỉ lệ handoff · dùng dữ liệu scrape
làm KB · re-chunk/re-index khi đổi provider.

---

## 12. Quyết định kỹ thuật (tóm tắt)

| Quyết định | Chọn | Vì sao |
|---|---|---|
| Vị trí | Mở rộng module ai/ ZaloCRM | Tận dụng hạ tầng; gửi Zalo thật được; tránh 2 hệ AI |
| Lưu vector | `Float[]` Postgres array + cosine app | KB nhỏ; không đụng DB image/RLS; YAGNI pgvector |
| Embedding | Provider-agnostic, mặc định local bge-m3 | Đã test; miễn phí; dữ liệu không ra ngoài; đổi được |
| LLM | Tái dùng `generateText()` + provider-registry | Đã có multi-provider, quota, key per-org |
| Usage log | Tái dùng AiSuggestion | Đã có; YAGNI bảng mới |
| Mức tự động | 2 luồng A (gợi ý) + B (auto-send), cờ bật/tắt | An toàn mặc định; auto khi DN tin tưởng |
| Quyết định gửi | Code TS, không phải LLM | Giữ kiểm soát (như bot Go) |
| Nhập KB | API trước, UI sau | MVP nhanh; UI giai đoạn sau |
