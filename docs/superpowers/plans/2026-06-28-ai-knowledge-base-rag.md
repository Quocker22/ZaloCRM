# RAG Knowledge Base (ZaloCRM module AI) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm knowledge base + RAG vào module AI ZaloCRM: ingest tài liệu DN → embed → lưu; khi có tin khách, tìm KB liên quan → sinh trả lời; (A) làm giàu gợi ý cho sale và (B) tự động gửi tin Zalo thật (cờ bật/tắt), câu khó thì handoff.

**Architecture:** Mở rộng `backend/src/modules/ai/` thêm khối `knowledge/` (embedding provider-agnostic, chunk, cosine in-app, ingest/search service, routes). Lưu vector dạng Postgres `Float[]` (KHÔNG pgvector). Tái dùng `generateText()`, provider-registry, AiConfig, AiSuggestion, `sendMessage()`. Quyết định gửi/handoff ở code TS, không để LLM tự gửi. Lỗi → im lặng + handoff.

**Tech Stack:** Node 20 + Fastify 5 + Prisma + Postgres 16 (alpine, no pgvector). TypeScript ESM (NodeNext, import dùng `.js` extension). Test: vitest (`*.test.ts` cạnh source, ưu tiên hàm thuần + mock). Embedding mặc định local Ollama bge-m3 qua OpenAI-compatible `/embeddings`. Spec: `docs/superpowers/specs/2026-06-28-ai-knowledge-base-rag-design.md`.

## Global Constraints

- Repo: `/Users/dinhvietquoc/Documents/workspaces/ZaloCRM-fork`. Backend cwd: `backend/`.
- TypeScript ESM: mọi import nội bộ PHẢI có đuôi `.js` (NodeNext). Mỗi file mới mở đầu bằng comment `// SPDX-License-Identifier: AGPL-3.0-or-later`.
- Test bằng vitest: `npm test` (chạy tất cả) hoặc `npx vitest run <path>` (một file). File test `*.test.ts` đặt CẠNH source.
- Convention Prisma: `id String @id @default(cuid())` cho bảng KB; `orgId @map("org_id")`; `@@map("snake_case")`; timestamps `createdAt`/`updatedAt`. Migration: `npm run db:migrate` (= `prisma migrate dev`).
- **Lưu vector: Postgres `Float[]` (double precision[]), KHÔNG pgvector.** KB nhỏ → cosine tính trong Node.
- **Quyết định gửi/handoff ở code TS, KHÔNG để LLM tự gửi. Lỗi bất kỳ → im lặng + handoff, không gửi rác.**
- Tái dùng (KHÔNG viết lại): `generateText(provider, apiKey, model, system, prompt, maxTokens?, baseUrlOverride?)` từ `src/modules/ai/ai-service.ts`; `getProviderBaseUrl(orgId, provider)`; `zaloOps.sendMessage(accountId, threadId, threadType: 0|1, msg, io?)` từ `src/shared/zalo-operations.ts` (msg dạng `{ msg: 'text' }`).
- KHÔNG đụng: Docker, DB image, pgvector, RLS core. Chỉ THÊM bảng org-scoped + policy theo pattern.
- Branch: tạo `feat/ai-knowledge-base` từ branch hiện tại (`main` đang có file sửa dở của user — tạo branch để cô lập; KHÔNG commit file đang sửa dở của user).

---

## File Structure

```
backend/src/modules/ai/knowledge/
  cosine.ts                       # cosine(a,b) — hàm thuần
  cosine.test.ts
  chunk.ts                        # chunkText(text, maxRunes) — hàm thuần
  chunk.test.ts
  embedding.ts                    # generateEmbedding(opts) — interface + dispatch provider
  embedding.test.ts
  providers/
    embedding-openai.ts           # embedOpenAICompat(baseUrl, apiKey, model, texts)
    embedding-gemini.ts           # embedGemini(baseUrl, apiKey, model, texts)
  knowledge-service.ts            # ingestDocument(...) + searchKnowledge(...) — đụng Prisma
  knowledge-service.test.ts       # test phần thuần (rankChunks) + ingest/search với prisma mock
  rank.ts                         # rankChunks(queryVec, chunks, topK) — hàm thuần (tách để test)
  rank.test.ts
  knowledge-routes.ts             # POST/GET/DELETE /api/v1/ai/knowledge
  rag-reply.ts                    # buildRagSystemPrompt + parseRagReply + decideAction — hàm thuần
  rag-reply.test.ts
  ai-auto-reply-hook.ts           # onIncomingMessageHook(...) — orchestrator luồng B
  ai-auto-reply-hook.test.ts      # ma trận quyết định (mock LLM/send/prisma)

backend/prisma/schema.prisma                       # +KnowledgeDocument +KnowledgeChunk +quan hệ Organization +AiConfig fields
backend/prisma/rls/tenant-rls.sql                  # +policy 2 bảng mới
backend/src/modules/ai/ai-routes.ts                # đăng ký knowledge-routes (hoặc app.ts)
backend/src/modules/ai/ai-virtual-chat-service.ts  # chèn KB vào buildUserPrompt (luồng A)
backend/src/modules/chat/message-handler.ts        # gọi onIncomingMessageHook sau runAutomationRules (luồng B)
```

---

## Task 0: Branch + Prisma schema (models + AiConfig fields) + migration

**Files:**
- Modify: `backend/prisma/schema.prisma`

**Interfaces:**
- Produces: bảng `knowledge_documents`, `knowledge_chunks`; AiConfig thêm field `kbEnabled`, `autoReplyEnabled`, `autoReplyConfidenceThreshold`, `autoReplyTagOnHandoff`, `embedProvider`, `embedModel`, `embedBaseUrl`. Prisma Client types `KnowledgeDocument`, `KnowledgeChunk`.

- [ ] **Step 1: Tạo branch**

```bash
cd /Users/dinhvietquoc/Documents/workspaces/ZaloCRM-fork
git switch -c feat/ai-knowledge-base
```

- [ ] **Step 2: Thêm 2 model vào schema.prisma**

Thêm vào cuối `backend/prisma/schema.prisma` (trước phần Extension nếu có, hoặc cuối file):

```prisma
model KnowledgeDocument {
  id        String   @id @default(cuid())
  orgId     String   @map("org_id")
  title     String
  source    String   @default("upload")
  content   String   @db.Text
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
  ord           Int
  content       String   @db.Text
  embedding     Float[]
  embedProvider String   @map("embed_provider")
  embedModel    String   @map("embed_model")
  embedDim      Int      @map("embed_dim")
  createdAt     DateTime @default(now()) @map("created_at")

  org      Organization      @relation(fields: [orgId], references: [id], onDelete: Cascade)
  document KnowledgeDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([orgId])
  @@index([documentId])
  @@map("knowledge_chunks")
}
```

- [ ] **Step 3: Thêm quan hệ ngược trên model Organization**

Tìm `model Organization {` trong schema.prisma, thêm 2 dòng quan hệ vào trong block (cạnh các quan hệ khác):

```prisma
  knowledgeDocuments KnowledgeDocument[]
  knowledgeChunks    KnowledgeChunk[]
```

- [ ] **Step 4: Thêm field config vào model AiConfig**

Tìm `model AiConfig {`, thêm các field sau (trước `createdAt`):

```prisma
  kbEnabled                    Boolean  @default(false) @map("kb_enabled")
  autoReplyEnabled             Boolean  @default(false) @map("auto_reply_enabled")
  autoReplyConfidenceThreshold Float    @default(0.7)   @map("auto_reply_confidence_threshold")
  autoReplyTagOnHandoff        String   @default("auto:can-sale") @map("auto_reply_tag_on_handoff")
  embedProvider                String   @default("local") @map("embed_provider")
  embedModel                   String   @default("bge-m3") @map("embed_model")
  embedBaseUrl                 String   @default("http://localhost:11434/v1") @map("embed_base_url")
```

- [ ] **Step 5: Tạo migration**

Run:
```bash
cd backend && npm run db:migrate
```
Khi prompt tên migration, nhập: `add_knowledge_base_and_ai_rag_config`
Expected: migration tạo 2 bảng + alter ai_configs; Prisma Client regenerate (types `KnowledgeDocument`, `KnowledgeChunk` xuất hiện).

> **Lưu ý:** nếu `db:migrate` cần DB chạy mà DB production đang dùng, cân nhắc chạy trên DB dev riêng, hoặc `npx prisma migrate dev --create-only` để xem SQL trước rồi apply. KHÔNG chạy lên DB production khi chưa review SQL.

- [ ] **Step 6: Verify build TypeScript không lỗi type**

Run: `cd backend && npx tsc --noEmit 2>&1 | head -20`
Expected: không lỗi liên quan KnowledgeDocument/KnowledgeChunk/AiConfig.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(ai/kb): Prisma models KnowledgeDocument/Chunk + AiConfig RAG fields"
```

---

## Task 1: `cosine.ts` — cosine similarity (hàm thuần)

**Files:**
- Create: `backend/src/modules/ai/knowledge/cosine.ts`
- Test: `backend/src/modules/ai/knowledge/cosine.test.ts`

**Interfaces:**
- Produces: `export function cosine(a: number[], b: number[]): number` — trả 0 nếu khác độ dài hoặc vector zero.

- [ ] **Step 1: Viết test thất bại**

`backend/src/modules/ai/knowledge/cosine.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { cosine } from './cosine.js';

describe('cosine', () => {
  it('identical vectors → ~1', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it('orthogonal → ~0', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('length mismatch → 0', () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
  });
  it('zero vector → 0', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});
```

- [ ] **Step 2: Chạy test cho fail**

Run: `cd backend && npx vitest run src/modules/ai/knowledge/cosine.test.ts`
Expected: FAIL — không tìm thấy module `./cosine.js`.

- [ ] **Step 3: Viết cosine.ts**

`backend/src/modules/ai/knowledge/cosine.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Cosine similarity in [-1,1]. Returns 0 on length mismatch or a zero-magnitude vector. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
```

- [ ] **Step 4: Chạy test cho pass**

Run: `cd backend && npx vitest run src/modules/ai/knowledge/cosine.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/knowledge/cosine.ts backend/src/modules/ai/knowledge/cosine.test.ts
git commit -m "feat(ai/kb): cosine similarity (pure)"
```

---

## Task 2: `chunk.ts` — chunk tài liệu (hàm thuần)

**Files:**
- Create: `backend/src/modules/ai/knowledge/chunk.ts`
- Test: `backend/src/modules/ai/knowledge/chunk.test.ts`

**Interfaces:**
- Produces: `export function chunkText(text: string, maxRunes?: number): string[]` — cắt theo đoạn (dòng trống), gộp tới ~maxRunes (mặc định 500), không trả chunk rỗng.

- [ ] **Step 1: Viết test thất bại**

`backend/src/modules/ai/knowledge/chunk.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { chunkText } from './chunk.js';

describe('chunkText', () => {
  it('cắt theo dòng trống thành nhiều chunk', () => {
    const out = chunkText('Đoạn một.\n\nĐoạn hai dài hơn.\n\nĐoạn ba.', 20);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((c) => c.trim().length > 0)).toBe(true);
  });
  it('text rỗng → mảng rỗng', () => {
    expect(chunkText('   ', 500)).toEqual([]);
  });
  it('một đoạn ngắn → một chunk', () => {
    expect(chunkText('Xin chào.', 500)).toEqual(['Xin chào.']);
  });
});
```

- [ ] **Step 2: Chạy test cho fail**

Run: `cd backend && npx vitest run src/modules/ai/knowledge/chunk.test.ts`
Expected: FAIL — module `./chunk.js` chưa có.

- [ ] **Step 3: Viết chunk.ts**

`backend/src/modules/ai/knowledge/chunk.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Split text into chunks of at most maxRunes runes, breaking on blank-line
 * paragraph boundaries. Accumulates paragraphs until adding the next would
 * exceed maxRunes. Never returns empty chunks.
 */
export function chunkText(text: string, maxRunes = 500): string[] {
  const paras = text.replace(/\r\n/g, '\n').split('\n\n');
  const chunks: string[] = [];
  let cur = '';
  const flush = () => {
    if (cur.trim().length > 0) chunks.push(cur.trim());
    cur = '';
  };
  for (const raw of paras) {
    const p = raw.trim();
    if (!p) continue;
    if (cur.length > 0 && [...cur].length + [...p].length > maxRunes) flush();
    cur = cur.length > 0 ? `${cur}\n\n${p}` : p;
  }
  flush();
  return chunks;
}
```

- [ ] **Step 4: Chạy test cho pass**

Run: `cd backend && npx vitest run src/modules/ai/knowledge/chunk.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/knowledge/chunk.ts backend/src/modules/ai/knowledge/chunk.test.ts
git commit -m "feat(ai/kb): paragraph chunker (pure)"
```

---

## Task 3: `embedding.ts` + providers — text → vector

**Files:**
- Create: `backend/src/modules/ai/knowledge/embedding.ts`, `backend/src/modules/ai/knowledge/providers/embedding-openai.ts`, `backend/src/modules/ai/knowledge/providers/embedding-gemini.ts`
- Test: `backend/src/modules/ai/knowledge/embedding.test.ts`

**Interfaces:**
- Produces:
  - `export interface EmbedOpts { provider: string; model: string; apiKey?: string; baseUrl?: string; texts: string[]; }`
  - `export async function generateEmbedding(opts: EmbedOpts): Promise<number[][]>` — provider `'local'|'openai'|'qwen'` → OpenAI-compat `/embeddings`; `'gemini'` → embedContent. Batch (cho ingest); search gọi mảng 1 phần tử.
  - `export async function embedOpenAICompat(baseUrl: string, apiKey: string | undefined, model: string, texts: string[]): Promise<number[][]>`
  - `export async function embedGemini(baseUrl: string, apiKey: string, model: string, texts: string[]): Promise<number[][]>`

- [ ] **Step 1: Viết test thất bại (mock global fetch)**

`backend/src/modules/ai/knowledge/embedding.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateEmbedding } from './embedding.js';

afterEach(() => vi.restoreAllMocks());

function mockFetchOnce(json: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => json,
  } as Response);
}

describe('generateEmbedding', () => {
  it('local (OpenAI-compat) parse data[].embedding', async () => {
    mockFetchOnce({ data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }] });
    const out = await generateEmbedding({ provider: 'local', model: 'bge-m3', baseUrl: 'http://x/v1', texts: ['a', 'b'] });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual([0.1, 0.2, 0.3]);
  });

  it('gemini parse embedding.values', async () => {
    // gemini gọi từng text một; mock trả cùng shape mỗi lần
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, status: 200, json: async () => ({ embedding: { values: [1, 2, 3] } }),
    } as Response);
    const out = await generateEmbedding({ provider: 'gemini', model: 'embedding-001', apiKey: 'k', baseUrl: 'http://g', texts: ['x'] });
    expect(out[0]).toEqual([1, 2, 3]);
  });

  it('provider lạ → throw', async () => {
    await expect(generateEmbedding({ provider: 'bogus', model: 'm', texts: ['a'] })).rejects.toThrow();
  });

  it('HTTP lỗi → throw', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, text: async () => 'err' } as Response);
    await expect(generateEmbedding({ provider: 'local', model: 'm', baseUrl: 'http://x/v1', texts: ['a'] })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Chạy test cho fail**

Run: `cd backend && npx vitest run src/modules/ai/knowledge/embedding.test.ts`
Expected: FAIL — `./embedding.js` chưa có.

- [ ] **Step 3: Viết providers/embedding-openai.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later

/** OpenAI-compatible /embeddings (Ollama local, OpenAI, Qwen). Batch input. */
export async function embedOpenAICompat(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  texts: string[],
): Promise<number[][]> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`embed openai-compat http ${res.status}: ${body}`);
  }
  const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
  return (data.data ?? []).map((d) => d.embedding);
}
```

- [ ] **Step 4: Viết providers/embedding-gemini.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later

/** Gemini embedContent — one request per text (API embeds a single content). */
export async function embedGemini(
  baseUrl: string,
  apiKey: string,
  model: string,
  texts: string[],
): Promise<number[][]> {
  const out: number[][] = [];
  for (const text of texts) {
    const url = `${baseUrl.replace(/\/$/, '')}/v1beta/models/${model}:embedContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: `models/${model}`, content: { parts: [{ text }] } }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`embed gemini http ${res.status}: ${body}`);
    }
    const data = (await res.json()) as { embedding?: { values?: number[] } };
    out.push(data.embedding?.values ?? []);
  }
  return out;
}
```

- [ ] **Step 5: Viết embedding.ts (dispatch)**

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { embedOpenAICompat } from './providers/embedding-openai.js';
import { embedGemini } from './providers/embedding-gemini.js';

export interface EmbedOpts {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  texts: string[];
}

/** text → vector. Batch for ingest; search calls with a single-element array. */
export async function generateEmbedding(opts: EmbedOpts): Promise<number[][]> {
  const { provider, model, apiKey, baseUrl, texts } = opts;
  if (provider === 'local' || provider === 'openai' || provider === 'qwen') {
    if (!baseUrl) throw new Error('embedding: baseUrl required for openai-compat provider');
    return embedOpenAICompat(baseUrl, apiKey, model, texts);
  }
  if (provider === 'gemini') {
    if (!apiKey || !baseUrl) throw new Error('embedding: gemini requires apiKey + baseUrl');
    return embedGemini(baseUrl, apiKey, model, texts);
  }
  throw new Error(`embedding: unknown provider ${provider}`);
}
```

- [ ] **Step 6: Chạy test cho pass**

Run: `cd backend && npx vitest run src/modules/ai/knowledge/embedding.test.ts`
Expected: PASS (4 test).

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/ai/knowledge/embedding.ts backend/src/modules/ai/knowledge/embedding.test.ts backend/src/modules/ai/knowledge/providers/
git commit -m "feat(ai/kb): embedding provider (OpenAI-compat + Gemini)"
```

---

## Task 4: `rank.ts` — rankChunks top-K (hàm thuần)

**Files:**
- Create: `backend/src/modules/ai/knowledge/rank.ts`
- Test: `backend/src/modules/ai/knowledge/rank.test.ts`

**Interfaces:**
- Consumes: `cosine` (Task 1).
- Produces:
  - `export interface ScoredChunk { id: string; content: string; embedding: number[]; embedDim: number; }`
  - `export interface Hit { chunkId: string; content: string; score: number; }`
  - `export function rankChunks(queryVec: number[], chunks: ScoredChunk[], topK: number): Hit[]` — bỏ chunk khác chiều với queryVec (cosine=0), sort giảm dần, lấy topK, bỏ score<=0.

- [ ] **Step 1: Viết test thất bại**

`backend/src/modules/ai/knowledge/rank.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { rankChunks } from './rank.js';

describe('rankChunks', () => {
  const chunks = [
    { id: 'near', content: 'gần', embedding: [1, 0, 0], embedDim: 3 },
    { id: 'far', content: 'xa', embedding: [0, 1, 0], embedDim: 3 },
  ];
  it('xếp theo cosine, lấy topK', () => {
    const hits = rankChunks([1, 0, 0], chunks, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].chunkId).toBe('near');
  });
  it('KB rỗng → []', () => {
    expect(rankChunks([1, 0, 0], [], 5)).toEqual([]);
  });
  it('bỏ chunk lệch chiều (cosine=0)', () => {
    const mixed = [{ id: 'wrongdim', content: 'x', embedding: [1, 0], embedDim: 2 }];
    expect(rankChunks([1, 0, 0], mixed, 5)).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test cho fail**

Run: `cd backend && npx vitest run src/modules/ai/knowledge/rank.test.ts`
Expected: FAIL.

- [ ] **Step 3: Viết rank.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { cosine } from './cosine.js';

export interface ScoredChunk {
  id: string;
  content: string;
  embedding: number[];
  embedDim: number;
}
export interface Hit {
  chunkId: string;
  content: string;
  score: number;
}

/**
 * Rank chunks by cosine to queryVec, descending. Chunks whose dimension differs
 * from the query (provider mismatch) score 0 via cosine and are dropped.
 */
export function rankChunks(queryVec: number[], chunks: ScoredChunk[], topK: number): Hit[] {
  const hits: Hit[] = [];
  for (const c of chunks) {
    const score = cosine(queryVec, c.embedding);
    if (score <= 0) continue;
    hits.push({ chunkId: c.id, content: c.content, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, Math.max(1, topK));
}
```

- [ ] **Step 4: Chạy test cho pass**

Run: `cd backend && npx vitest run src/modules/ai/knowledge/rank.test.ts`
Expected: PASS (3 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/knowledge/rank.ts backend/src/modules/ai/knowledge/rank.test.ts
git commit -m "feat(ai/kb): rankChunks top-K (pure)"
```

---

## Task 5: `rag-reply.ts` — prompt + parse + decideAction (hàm thuần)

**Files:**
- Create: `backend/src/modules/ai/knowledge/rag-reply.ts`
- Test: `backend/src/modules/ai/knowledge/rag-reply.test.ts`

**Interfaces:**
- Produces:
  - `export function buildRagSystemPrompt(bizName: string, kbChunks: string[]): string`
  - `export interface RagReply { reply: string; confidence: number; needsHuman: boolean; reason: string; }`
  - `export function parseRagReply(raw: string): RagReply` — trích `{...}` đầu tiên, parse JSON, default an toàn nếu hỏng (confidence 0, needsHuman true).
  - `export type Action = 'send' | 'handoff';`
  - `export function decideAction(rep: RagReply, opts: { autoReplyEnabled: boolean; threshold: number }): Action` — send chỉ khi autoReplyEnabled && !needsHuman && confidence>=threshold.

- [ ] **Step 1: Viết test thất bại**

`backend/src/modules/ai/knowledge/rag-reply.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { buildRagSystemPrompt, parseRagReply, decideAction } from './rag-reply.js';

describe('buildRagSystemPrompt', () => {
  it('chứa biz name + chunk + JSON + needs_human', () => {
    const s = buildRagSystemPrompt('LEDNELIA', ['Mở 9h-22h.', 'Có giao hàng.']);
    expect(s).toContain('LEDNELIA');
    expect(s).toContain('Mở 9h-22h');
    expect(s.toLowerCase()).toContain('json');
    expect(s.toLowerCase()).toContain('needs_human');
  });
});

describe('parseRagReply', () => {
  it('parse JSON sạch', () => {
    const r = parseRagReply('{"reply":"hi","confidence":0.9,"needs_human":false,"reason":"ok"}');
    expect(r.confidence).toBe(0.9);
    expect(r.needsHuman).toBe(false);
    expect(r.reply).toBe('hi');
  });
  it('trích JSON lẫn prose', () => {
    const r = parseRagReply('Đây là kết quả: {"reply":"x","confidence":0.5,"needs_human":true,"reason":"r"} hết.');
    expect(r.reply).toBe('x');
    expect(r.needsHuman).toBe(true);
  });
  it('JSON hỏng → default an toàn (handoff)', () => {
    const r = parseRagReply('không phải json');
    expect(r.needsHuman).toBe(true);
    expect(r.confidence).toBe(0);
  });
});

describe('decideAction', () => {
  const base = { reply: 'x', confidence: 0.9, needsHuman: false, reason: '' };
  it('tự tin + bật → send', () => {
    expect(decideAction(base, { autoReplyEnabled: true, threshold: 0.7 })).toBe('send');
  });
  it('tắt auto → handoff', () => {
    expect(decideAction(base, { autoReplyEnabled: false, threshold: 0.7 })).toBe('handoff');
  });
  it('needs_human → handoff', () => {
    expect(decideAction({ ...base, needsHuman: true }, { autoReplyEnabled: true, threshold: 0.7 })).toBe('handoff');
  });
  it('confidence thấp → handoff', () => {
    expect(decideAction({ ...base, confidence: 0.3 }, { autoReplyEnabled: true, threshold: 0.7 })).toBe('handoff');
  });
});
```

- [ ] **Step 2: Chạy test cho fail**

Run: `cd backend && npx vitest run src/modules/ai/knowledge/rag-reply.test.ts`
Expected: FAIL.

- [ ] **Step 3: Viết rag-reply.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later

export interface RagReply {
  reply: string;
  confidence: number;
  needsHuman: boolean;
  reason: string;
}
export type Action = 'send' | 'handoff';

/** System prompt: role + KB chunks + JSON contract (incl. needs_human criteria). */
export function buildRagSystemPrompt(bizName: string, kbChunks: string[]): string {
  const docs = kbChunks.length ? kbChunks.map((c) => `- ${c}`).join('\n') : '(không có tài liệu liên quan)';
  return [
    `Bạn là trợ lý tư vấn của ${bizName}. Trả lời khách bằng tiếng Việt, ngắn gọn, thân thiện,`,
    'CHỈ dựa trên TÀI LIỆU dưới đây. Nếu không chắc, đừng bịa.',
    '',
    '=== TÀI LIỆU ===',
    docs,
    '',
    '=== ĐỊNH DẠNG TRẢ LỜI ===',
    'CHỈ trả về một object JSON, không kèm văn bản nào khác, theo schema:',
    '{"reply": string, "confidence": number (0..1), "needs_human": boolean, "reason": string}',
    'Đặt needs_human=true khi: khách hỏi GIÁ/HỢP ĐỒNG cụ thể, KHIẾU NẠI, câu NGOÀI tài liệu,',
    'hoặc khách XIN GẶP NGƯỜI. confidence là mức bạn chắc câu trả lời đúng và đủ.',
  ].join('\n');
}

/** Extract the first {...} block and parse. On any failure, default to a safe handoff. */
export function parseRagReply(raw: string): RagReply {
  let s = raw.trim();
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  try {
    const o = JSON.parse(s) as Record<string, unknown>;
    return {
      reply: typeof o.reply === 'string' ? o.reply : '',
      confidence: typeof o.confidence === 'number' ? o.confidence : 0,
      needsHuman: o.needs_human === true,
      reason: typeof o.reason === 'string' ? o.reason : '',
    };
  } catch {
    return { reply: '', confidence: 0, needsHuman: true, reason: 'parse-failed' };
  }
}

/** Decision lives in code, never in the LLM. Send only when confident AND auto enabled. */
export function decideAction(rep: RagReply, opts: { autoReplyEnabled: boolean; threshold: number }): Action {
  if (opts.autoReplyEnabled && !rep.needsHuman && rep.confidence >= opts.threshold) return 'send';
  return 'handoff';
}
```

- [ ] **Step 4: Chạy test cho pass**

Run: `cd backend && npx vitest run src/modules/ai/knowledge/rag-reply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/knowledge/rag-reply.ts backend/src/modules/ai/knowledge/rag-reply.test.ts
git commit -m "feat(ai/kb): RAG prompt + parse + decideAction (pure)"
```

---

## Task 6: `knowledge-service.ts` — ingest + search (đụng Prisma)

**Files:**
- Create: `backend/src/modules/ai/knowledge/knowledge-service.ts`
- Test: `backend/src/modules/ai/knowledge/knowledge-service.test.ts`

**Interfaces:**
- Consumes: `chunkText` (Task 2), `generateEmbedding` (Task 3), `rankChunks`/`Hit` (Task 4), Prisma client.
- Produces:
  - `export interface IngestDeps { prisma: PrismaLike; embed: typeof generateEmbedding; }` — inject để test (không cần DB thật).
  - `export interface EmbedConfig { provider: string; model: string; apiKey?: string; baseUrl?: string; }`
  - `export async function ingestDocument(deps, orgId: string, doc: { title: string; source?: string; content: string }, cfg: EmbedConfig): Promise<{ documentId: string; chunks: number }>`
  - `export async function searchKnowledge(deps, orgId: string, query: string, topK: number, cfg: EmbedConfig): Promise<Hit[]>`
  - `PrismaLike` là interface hẹp chỉ chứa các method dùng (knowledgeDocument.create, knowledgeChunk.createMany, knowledgeChunk.findMany) — để mock.

- [ ] **Step 1: Viết test thất bại (mock prisma + embed)**

`backend/src/modules/ai/knowledge/knowledge-service.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest';
import { ingestDocument, searchKnowledge } from './knowledge-service.js';

const cfg = { provider: 'local', model: 'bge-m3', baseUrl: 'http://x/v1' };

function fakeDeps() {
  const created: any[] = [];
  const prisma = {
    knowledgeDocument: { create: vi.fn(async ({ data }: any) => ({ id: 'doc1', ...data })) },
    knowledgeChunk: {
      createMany: vi.fn(async ({ data }: any) => { created.push(...data); return { count: data.length }; }),
      findMany: vi.fn(async () => created.map((c, i) => ({ id: `c${i}`, content: c.content, embedding: c.embedding, embedDim: c.embedDim }))),
    },
  };
  const embed = vi.fn(async ({ texts }: any) => texts.map((t: string) => [t.length, 1, 0]));
  return { deps: { prisma, embed } as any, prisma, embed, created };
}

describe('ingestDocument', () => {
  it('chunk + embed + lưu document & chunks', async () => {
    const { deps, prisma } = fakeDeps();
    const res = await ingestDocument(deps, 'org1', { title: 'FAQ', content: 'Câu một.\n\nCâu hai.' }, cfg);
    expect(res.documentId).toBe('doc1');
    expect(res.chunks).toBeGreaterThanOrEqual(1);
    expect(prisma.knowledgeDocument.create).toHaveBeenCalled();
    expect(prisma.knowledgeChunk.createMany).toHaveBeenCalled();
  });
});

describe('searchKnowledge', () => {
  it('embed query + rank top-K', async () => {
    const { deps } = fakeDeps();
    await ingestDocument(deps, 'org1', { title: 'd', content: 'aaaa.\n\nbb.' }, cfg);
    const hits = await searchKnowledge(deps, 'org1', 'query', 1, cfg);
    expect(hits.length).toBe(1);
    expect(hits[0]).toHaveProperty('content');
  });

  it('embed lỗi khi ingest → throw (không lưu nửa vời)', async () => {
    const { deps } = fakeDeps();
    (deps.embed as any).mockRejectedValueOnce(new Error('embed down'));
    await expect(ingestDocument(deps, 'org1', { title: 'd', content: 'x' }, cfg)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Chạy test cho fail**

Run: `cd backend && npx vitest run src/modules/ai/knowledge/knowledge-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Viết knowledge-service.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { chunkText } from './chunk.js';
import { generateEmbedding } from './embedding.js';
import { rankChunks, type Hit } from './rank.js';

export interface EmbedConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

// Narrow Prisma surface — only what we use, so tests can mock without a DB.
export interface PrismaLike {
  knowledgeDocument: { create(args: { data: Record<string, unknown> }): Promise<{ id: string }> };
  knowledgeChunk: {
    createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
    findMany(args: { where: { orgId: string }; select: Record<string, boolean> }): Promise<
      Array<{ id: string; content: string; embedding: number[]; embedDim: number }>
    >;
  };
}

export interface IngestDeps {
  prisma: PrismaLike;
  embed: typeof generateEmbedding;
}

const CHUNK_RUNES = 500;

export async function ingestDocument(
  deps: IngestDeps,
  orgId: string,
  doc: { title: string; source?: string; content: string },
  cfg: EmbedConfig,
): Promise<{ documentId: string; chunks: number }> {
  const chunks = chunkText(doc.content, CHUNK_RUNES);
  // Embed BEFORE persisting anything beyond the document, so an embedding failure
  // doesn't leave half-written chunks. (Document row is cheap; chunks gate on embed.)
  const document = await deps.prisma.knowledgeDocument.create({
    data: { orgId, title: doc.title, source: doc.source ?? 'upload', content: doc.content },
  });
  if (chunks.length === 0) return { documentId: document.id, chunks: 0 };
  const vectors = await deps.embed({ ...cfg, texts: chunks });
  await deps.prisma.knowledgeChunk.createMany({
    data: chunks.map((content, ord) => ({
      orgId,
      documentId: document.id,
      ord,
      content,
      embedding: vectors[ord],
      embedProvider: cfg.provider,
      embedModel: cfg.model,
      embedDim: vectors[ord].length,
    })),
  });
  return { documentId: document.id, chunks: chunks.length };
}

export async function searchKnowledge(
  deps: IngestDeps,
  orgId: string,
  query: string,
  topK: number,
  cfg: EmbedConfig,
): Promise<Hit[]> {
  const [queryVec] = await deps.embed({ ...cfg, texts: [query] });
  const rows = await deps.prisma.knowledgeChunk.findMany({
    where: { orgId },
    select: { id: true, content: true, embedding: true, embedDim: true },
  });
  return rankChunks(queryVec, rows, topK);
}
```

- [ ] **Step 4: Chạy test cho pass**

Run: `cd backend && npx vitest run src/modules/ai/knowledge/knowledge-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/knowledge/knowledge-service.ts backend/src/modules/ai/knowledge/knowledge-service.test.ts
git commit -m "feat(ai/kb): knowledge service ingest + search (DI prisma)"
```

---

## Task 7: `ai-auto-reply-hook.ts` — orchestrator luồng B + ma trận quyết định

**Files:**
- Create: `backend/src/modules/ai/knowledge/ai-auto-reply-hook.ts`
- Test: `backend/src/modules/ai/knowledge/ai-auto-reply-hook.test.ts`

**Interfaces:**
- Consumes: `searchKnowledge` (Task 6), `buildRagSystemPrompt`/`parseRagReply`/`decideAction` (Task 5).
- Produces:
  - `export interface HookDeps { search(orgId, query, topK): Promise<{ content: string }[]>; generate(system, prompt): Promise<string>; sendReply(accountId, threadId, threadType, text): Promise<void>; addTag(contactId, tag): Promise<void>; alreadyHandled(messageId): Promise<boolean>; recordSuggestion(rec): Promise<void>; }`
  - `export interface HookInput { orgId, conversation: { id; isVirtual; zaloAccountId; externalThreadId; threadType; contactId; hasHandoffTag: boolean }, message: { id; content; isSelf }, cfg: { bizName; autoReplyEnabled; threshold; topK; tagOnHandoff } }`
  - `export async function onIncomingMessageHook(deps: HookDeps, input: HookInput): Promise<'sent' | 'handoff' | 'ignored'>` — quyết định ở code, không LLM. Lỗi → handoff.

- [ ] **Step 1: Viết test ma trận quyết định**

`backend/src/modules/ai/knowledge/ai-auto-reply-hook.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest';
import { onIncomingMessageHook } from './ai-auto-reply-hook.js';

function deps(genReply: string) {
  return {
    search: vi.fn(async () => [{ content: 'Mở 9h-22h' }]),
    generate: vi.fn(async () => genReply),
    sendReply: vi.fn(async () => {}),
    addTag: vi.fn(async () => {}),
    alreadyHandled: vi.fn(async () => false),
    recordSuggestion: vi.fn(async () => {}),
  };
}
const conv = { id: 'c1', isVirtual: false, zaloAccountId: 'a', externalThreadId: 't', threadType: 'user', contactId: 'ct', hasHandoffTag: false };
const baseInput = (over: any = {}) => ({
  orgId: 'org1',
  conversation: { ...conv, ...(over.conversation ?? {}) },
  message: { id: 'm1', content: 'mấy giờ mở?', isSelf: false, ...(over.message ?? {}) },
  cfg: { bizName: 'ABC', autoReplyEnabled: true, threshold: 0.7, topK: 5, tagOnHandoff: 'auto:can-sale', ...(over.cfg ?? {}) },
});
const confident = '{"reply":"9h-22h","confidence":0.9,"needs_human":false,"reason":""}';

describe('onIncomingMessageHook', () => {
  it('tự tin + autoReply bật → sent', async () => {
    const d = deps(confident);
    const r = await onIncomingMessageHook(d, baseInput());
    expect(r).toBe('sent');
    expect(d.sendReply).toHaveBeenCalled();
    expect(d.addTag).not.toHaveBeenCalled();
  });
  it('autoReply tắt → handoff (gắn tag, không gửi)', async () => {
    const d = deps(confident);
    const r = await onIncomingMessageHook(d, baseInput({ cfg: { autoReplyEnabled: false } }));
    expect(r).toBe('handoff');
    expect(d.sendReply).not.toHaveBeenCalled();
    expect(d.addTag).toHaveBeenCalledWith('ct', 'auto:can-sale');
  });
  it('needs_human → handoff', async () => {
    const d = deps('{"reply":"x","confidence":0.9,"needs_human":true,"reason":"giá"}');
    expect(await onIncomingMessageHook(d, baseInput())).toBe('handoff');
    expect(d.sendReply).not.toHaveBeenCalled();
  });
  it('confidence thấp → handoff', async () => {
    const d = deps('{"reply":"x","confidence":0.2,"needs_human":false,"reason":""}');
    expect(await onIncomingMessageHook(d, baseInput())).toBe('handoff');
  });
  it('tin của self → ignored', async () => {
    const d = deps(confident);
    expect(await onIncomingMessageHook(d, baseInput({ message: { isSelf: true } }))).toBe('ignored');
    expect(d.generate).not.toHaveBeenCalled();
  });
  it('hội thoại virtual → ignored', async () => {
    const d = deps(confident);
    expect(await onIncomingMessageHook(d, baseInput({ conversation: { isVirtual: true } }))).toBe('ignored');
  });
  it('đã có tag handoff → ignored', async () => {
    const d = deps(confident);
    expect(await onIncomingMessageHook(d, baseInput({ conversation: { hasHandoffTag: true } }))).toBe('ignored');
  });
  it('messageId đã xử lý → ignored', async () => {
    const d = deps(confident);
    d.alreadyHandled = vi.fn(async () => true);
    expect(await onIncomingMessageHook(d, baseInput())).toBe('ignored');
  });
  it('LLM lỗi → handoff (không gửi rác)', async () => {
    const d = deps(confident);
    d.generate = vi.fn(async () => { throw new Error('llm down'); });
    expect(await onIncomingMessageHook(d, baseInput())).toBe('handoff');
    expect(d.sendReply).not.toHaveBeenCalled();
  });
  it('sendReply lỗi → handoff (không retry mù)', async () => {
    const d = deps(confident);
    d.sendReply = vi.fn(async () => { throw new Error('send fail'); });
    expect(await onIncomingMessageHook(d, baseInput())).toBe('handoff');
    expect(d.addTag).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy test cho fail**

Run: `cd backend && npx vitest run src/modules/ai/knowledge/ai-auto-reply-hook.test.ts`
Expected: FAIL.

- [ ] **Step 3: Viết ai-auto-reply-hook.ts**

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { buildRagSystemPrompt, parseRagReply, decideAction } from './rag-reply.js';

export interface HookDeps {
  search(orgId: string, query: string, topK: number): Promise<Array<{ content: string }>>;
  generate(system: string, prompt: string): Promise<string>;
  sendReply(accountId: string, threadId: string, threadType: 0 | 1, text: string): Promise<void>;
  addTag(contactId: string, tag: string): Promise<void>;
  alreadyHandled(messageId: string): Promise<boolean>;
  recordSuggestion(rec: {
    messageId: string;
    conversationId: string;
    content: string;
    confidence: number;
    decision: string;
  }): Promise<void>;
}

export interface HookInput {
  orgId: string;
  conversation: {
    id: string;
    isVirtual: boolean;
    zaloAccountId: string | null;
    externalThreadId: string | null;
    threadType: string;
    contactId: string | null;
    hasHandoffTag: boolean;
  };
  message: { id: string; content: string; isSelf: boolean };
  cfg: { bizName: string; autoReplyEnabled: boolean; threshold: number; topK: number; tagOnHandoff: string };
}

/**
 * Auto-reply orchestrator (flow B). Decision lives here in code, never the LLM.
 * Any error after filtering results in a silent handoff — never sends garbage.
 */
export async function onIncomingMessageHook(
  deps: HookDeps,
  input: HookInput,
): Promise<'sent' | 'handoff' | 'ignored'> {
  const { conversation: conv, message, cfg } = input;

  // 1. Filter
  if (message.isSelf || !message.content.trim()) return 'ignored';
  if (conv.isVirtual || conv.hasHandoffTag) return 'ignored';
  if (await deps.alreadyHandled(message.id)) return 'ignored';

  const handoff = async (rep: { content: string; confidence: number }, decision: string) => {
    if (conv.contactId) {
      try {
        await deps.addTag(conv.contactId, cfg.tagOnHandoff);
      } catch {
        /* tag failure is non-fatal; still record */
      }
    }
    await deps.recordSuggestion({
      messageId: message.id,
      conversationId: conv.id,
      content: rep.content,
      confidence: rep.confidence,
      decision,
    });
    return 'handoff' as const;
  };

  // 2. Search KB (failure degrades to empty context → low confidence → handoff)
  let chunks: string[] = [];
  try {
    chunks = (await deps.search(input.orgId, message.content, cfg.topK)).map((h) => h.content);
  } catch {
    chunks = [];
  }

  // 3. Generate
  let rep;
  try {
    const system = buildRagSystemPrompt(cfg.bizName, chunks);
    const raw = await deps.generate(system, message.content);
    rep = parseRagReply(raw);
  } catch {
    return handoff({ content: '', confidence: 0 }, 'skipped');
  }

  // 4. Decide (code, not LLM)
  const action = decideAction(rep, { autoReplyEnabled: cfg.autoReplyEnabled, threshold: cfg.threshold });
  if (action === 'handoff') {
    return handoff({ content: rep.reply, confidence: rep.confidence }, 'handoff');
  }

  // action === 'send'
  if (!conv.zaloAccountId || !conv.externalThreadId) {
    return handoff({ content: rep.reply, confidence: rep.confidence }, 'skipped');
  }
  const threadType: 0 | 1 = conv.threadType === 'group' ? 1 : 0;
  try {
    await deps.sendReply(conv.zaloAccountId, conv.externalThreadId, threadType, rep.reply);
  } catch {
    // Do NOT retry blindly (avoid double-send). Fall back to handoff.
    return handoff({ content: rep.reply, confidence: rep.confidence }, 'skipped');
  }
  await deps.recordSuggestion({
    messageId: message.id,
    conversationId: conv.id,
    content: rep.reply,
    confidence: rep.confidence,
    decision: 'sent',
  });
  return 'sent';
}
```

- [ ] **Step 4: Chạy test cho pass**

Run: `cd backend && npx vitest run src/modules/ai/knowledge/ai-auto-reply-hook.test.ts`
Expected: PASS (10 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/ai/knowledge/ai-auto-reply-hook.ts backend/src/modules/ai/knowledge/ai-auto-reply-hook.test.ts
git commit -m "feat(ai/kb): auto-reply hook + decision matrix (DI, pure-testable)"
```

---

## Task 8: `knowledge-routes.ts` — API ingest/list/delete + đăng ký

**Files:**
- Create: `backend/src/modules/ai/knowledge/knowledge-routes.ts`
- Modify: `backend/src/modules/ai/ai-routes.ts` (đăng ký) HOẶC `backend/src/app.ts` — theo cách các route ai khác được mount.

**Interfaces:**
- Consumes: `ingestDocument`/`searchKnowledge` (Task 6), Prisma client thật, AiConfig (lấy embed provider/model/baseUrl + key per-org qua provider-registry).
- Produces: routes `POST/GET/DELETE /api/v1/ai/knowledge`. Auth org theo pattern các route `/api/v1/ai/*` hiện có.

- [ ] **Step 1: Đọc cách ai-routes.ts đăng ký + lấy orgId + lấy AiConfig**

Run: `cd backend && sed -n '1,60p' src/modules/ai/ai-routes.ts`
Mục tiêu: nắm cách lấy `orgId` (vd `(request as any).orgId`), cách load AiConfig (prisma.aiConfig.findUnique), cách lấy embed key per-org (provider-registry / getProviderBaseUrl). Dùng đúng pattern đó ở bước 2.

- [ ] **Step 2: Viết knowledge-routes.ts**

`backend/src/modules/ai/knowledge/knowledge-routes.ts` (điều chỉnh import/orgId cho khớp pattern đọc ở Step 1):

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db.js'; // ĐIỀU CHỈNH: dùng đúng đường dẫn prisma client của repo
import { generateEmbedding } from './embedding.js';
import { ingestDocument, searchKnowledge, type EmbedConfig } from './knowledge-service.js';

async function embedConfigForOrg(orgId: string): Promise<EmbedConfig> {
  const cfg = await prisma.aiConfig.findUnique({ where: { orgId } });
  return {
    provider: cfg?.embedProvider ?? 'local',
    model: cfg?.embedModel ?? 'bge-m3',
    baseUrl: cfg?.embedBaseUrl ?? 'http://localhost:11434/v1',
    // apiKey: lấy per-org qua provider-registry nếu provider != local (xem Step 1)
  };
}

export function registerKnowledgeRoutes(app: FastifyInstance): void {
  const deps = { prisma: prisma as any, embed: generateEmbedding };

  app.post('/api/v1/ai/knowledge', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = (request as any).orgId as string;
    const body = request.body as { title?: string; source?: string; content?: string };
    if (!body?.title || !body?.content) {
      return reply.status(400).send({ error: 'title and content are required' });
    }
    try {
      const cfg = await embedConfigForOrg(orgId);
      const res = await ingestDocument(deps, orgId, { title: body.title, source: body.source, content: body.content }, cfg);
      return res;
    } catch (err) {
      request.log.error({ err }, '[ai/kb] ingest failed');
      return reply.status(500).send({ error: 'ingest failed' });
    }
  });

  app.get('/api/v1/ai/knowledge', async (request: FastifyRequest) => {
    const orgId = (request as any).orgId as string;
    const docs = await prisma.knowledgeDocument.findMany({
      where: { orgId },
      select: { id: true, title: true, source: true, createdAt: true, _count: { select: { chunks: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return { documents: docs };
  });

  app.delete('/api/v1/ai/knowledge/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = (request as any).orgId as string;
    const { id } = request.params as { id: string };
    await prisma.knowledgeDocument.deleteMany({ where: { id, orgId } });
    return reply.status(204).send();
  });
}
```

> **Lưu ý người triển khai:** (1) đường dẫn import `prisma` + cách lấy `orgId` PHẢI khớp pattern repo (đọc ở Step 1; các route public dùng `(request as any).orgId`, route `/api/v1/*` có thể qua JWT middleware — dùng đúng cái ai-routes đang dùng). (2) `searchKnowledge` import sẵn để dùng ở Task 9/luồng A, không cần route riêng. (3) Auth: mount trong cùng scope đã áp middleware org của các route `/api/v1/ai/*`.

- [ ] **Step 3: Đăng ký route**

Trong `ai-routes.ts` (hoặc nơi mount route ai), thêm:
```ts
import { registerKnowledgeRoutes } from './knowledge/knowledge-routes.js';
// trong hàm đăng ký routes ai:
registerKnowledgeRoutes(app);
```

- [ ] **Step 4: Build check**

Run: `cd backend && npx tsc --noEmit 2>&1 | grep -i knowledge | head`
Expected: không lỗi type ở knowledge-routes.

- [ ] **Step 5: Smoke test thủ công (cần DB + server chạy)**

Sau khi server chạy (`npm run dev`), với một API key org hợp lệ:
```bash
curl -s -X POST http://localhost:3000/api/v1/ai/knowledge \
  -H 'content-type: application/json' -H 'X-Api-Key: <KEY>' \
  -d '{"title":"FAQ","content":"Mở cửa 9h-22h.\n\nCó giao hàng nội thành."}'
```
Expected: `{"documentId":"...","chunks":...}` (cần Ollama bge-m3 chạy ở LOCAL_BASE_URL). Nếu chưa có DB/Ollama, bỏ qua bước này — unit test đã phủ logic.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/ai/knowledge/knowledge-routes.ts backend/src/modules/ai/ai-routes.ts
git commit -m "feat(ai/kb): knowledge ingest/list/delete routes"
```

---

## Task 9: Nối luồng A (gợi ý sale) + luồng B (hook tin đến)

**Files:**
- Modify: `backend/src/modules/ai/ai-virtual-chat-service.ts` (luồng A — chèn KB vào prompt)
- Modify: `backend/src/modules/chat/message-handler.ts` (luồng B — gọi hook sau runAutomationRules)
- Create: `backend/src/modules/ai/knowledge/auto-reply-wiring.ts` (ráp HookDeps thật từ prisma + generateText + zaloOps)

**Interfaces:**
- Consumes: `onIncomingMessageHook`/`HookDeps`/`HookInput` (Task 7), `searchKnowledge` (Task 6), `generateText` + `getProviderBaseUrl` (ai-service), `zaloOps.sendMessage` (shared), prisma.
- Produces: `export async function runAutoReplyForMessage(ctx): Promise<void>` — wiring fire-and-forget gọi từ message-handler.

- [ ] **Step 1: Luồng A — chèn KB vào buildUserPrompt**

Đọc `ai-virtual-chat-service.ts` quanh `buildUserPrompt` (≈ line 276-296) và `buildContext` (≈ line 100). Thêm: nếu AiConfig.kbEnabled, gọi `searchKnowledge` với **tin khách gần nhất** (tin contact cuối trong lịch sử) → chèn khối `<knowledge_base>\n{chunks}\n</knowledge_base>` vào userPrompt TRƯỚC `<latest_sale_message>`. Bọc try/catch — lỗi KB không làm hỏng gợi ý (chèn rỗng).

Mẫu thay đổi (điều chỉnh tên biến cho khớp file thật):
```ts
// trong buildContext() hoặc ngay trước generateText:
let kbBlock = '';
if (config.kbEnabled) {
  try {
    const lastCustomerMsg = history.filter((m) => m.senderType === 'contact').at(-1)?.content ?? ctx.latestSaleMessage;
    const hits = await searchKnowledge(
      { prisma, embed: generateEmbedding },
      orgId,
      lastCustomerMsg,
      5,
      { provider: config.embedProvider, model: config.embedModel, baseUrl: config.embedBaseUrl },
    );
    if (hits.length) kbBlock = `\n<knowledge_base>\n${hits.map((h) => h.content).join('\n')}\n</knowledge_base>\n`;
  } catch (err) {
    logger.warn(`[ai/kb] search failed for org=${orgId}: ${err}`);
  }
}
// rồi nối kbBlock vào userPrompt trước <latest_sale_message>
```

- [ ] **Step 2: Viết auto-reply-wiring.ts (HookDeps thật)**

`backend/src/modules/ai/knowledge/auto-reply-wiring.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { prisma } from '../../../db.js'; // ĐIỀU CHỈNH đường dẫn prisma
import { generateText } from '../ai-service.js';
import { getProviderBaseUrl } from '../provider-registry.js'; // ĐIỀU CHỈNH nếu tên khác
import { getApiKeyForOrg } from '../provider-registry.js';     // ĐIỀU CHỈNH: hàm lấy key per-org
import * as zaloOps from '../../../shared/zalo-operations.js';
import { generateEmbedding } from './embedding.js';
import { searchKnowledge } from './knowledge-service.js';
import { onIncomingMessageHook, type HookInput } from './ai-auto-reply-hook.js';

export async function runAutoReplyForMessage(input: {
  orgId: string;
  conversation: HookInput['conversation'];
  message: HookInput['message'];
}): Promise<void> {
  const cfg = await prisma.aiConfig.findUnique({ where: { orgId: input.orgId } });
  if (!cfg) return;

  const llmApiKey = await getApiKeyForOrg(input.orgId, cfg.provider); // ĐIỀU CHỈNH theo registry
  const llmBaseUrl = await getProviderBaseUrl(input.orgId, cfg.provider);
  const embedCfg = { provider: cfg.embedProvider, model: cfg.embedModel, baseUrl: cfg.embedBaseUrl };

  await onIncomingMessageHook(
    {
      search: async (orgId, query, topK) =>
        searchKnowledge({ prisma: prisma as any, embed: generateEmbedding }, orgId, query, topK, embedCfg),
      generate: (system, prompt) =>
        generateText(cfg.provider, llmApiKey, cfg.model, system, prompt, 800, llmBaseUrl),
      sendReply: async (accountId, threadId, threadType, text) => {
        await zaloOps.sendMessage(accountId, threadId, threadType, { msg: text });
      },
      addTag: async (contactId, tag) => {
        const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { tags: true } });
        const tags = Array.isArray(c?.tags) ? (c!.tags as string[]) : [];
        if (!tags.includes(tag)) {
          await prisma.contact.update({ where: { id: contactId }, data: { tags: [...tags, tag] } });
        }
      },
      alreadyHandled: async (messageId) => {
        const n = await prisma.aiSuggestion.count({ where: { orgId: input.orgId, messageId } }); // ĐIỀU CHỈNH field
        return n > 0;
      },
      recordSuggestion: async (rec) => {
        await prisma.aiSuggestion.create({
          data: {
            orgId: input.orgId,
            conversationId: rec.conversationId,
            messageId: rec.messageId,
            type: 'auto_reply_rag',
            content: rec.content.slice(0, 2000),
            confidence: rec.confidence,
          },
        }); // ĐIỀU CHỈNH field names theo model AiSuggestion thật
      },
    },
    {
      orgId: input.orgId,
      conversation: input.conversation,
      message: input.message,
      cfg: {
        bizName: cfg.aiAssistantPromptTemplate ? '' : '', // ĐIỀU CHỈNH: lấy tên DN từ Organization.name
        autoReplyEnabled: cfg.autoReplyEnabled,
        threshold: cfg.autoReplyConfidenceThreshold,
        topK: 5,
        tagOnHandoff: cfg.autoReplyTagOnHandoff,
      },
    },
  );
}
```

> **Lưu ý người triển khai:** các điểm ĐIỀU CHỈNH (đường dẫn prisma, tên hàm lấy key per-org, field của AiSuggestion, lấy `Organization.name` cho bizName, hình dạng `Contact.tags`) phải khớp source thật — đọc model AiSuggestion + provider-registry trước khi viết. Logic quyết định KHÔNG đổi (đã test ở Task 7); file này chỉ là dây nối.

- [ ] **Step 3: Luồng B — gọi hook trong message-handler.ts**

Đọc `message-handler.ts` quanh `runAutomationRules` (≈ line 637). Thêm SAU nó (fire-and-forget), lấy `conversation` đã có sẵn trong scope (có `zaloAccountId`, `externalThreadId`, `threadType`, `contactId`, `isVirtual`); `hasHandoffTag` tính từ contact.tags:

```ts
import { runAutoReplyForMessage } from '../ai/knowledge/auto-reply-wiring.js';
// ... sau runAutomationRules, trong nhánh !msg.isSelf:
void runAutoReplyForMessage({
  orgId: account.orgId,
  conversation: {
    id: conversation.id,
    isVirtual: conversation.isVirtual ?? false,
    zaloAccountId: conversation.zaloAccountId ?? null,
    externalThreadId: conversation.externalThreadId ?? null,
    threadType: conversation.threadType,
    contactId: contact?.id ?? null,
    hasHandoffTag: Array.isArray(contact?.tags) && (contact!.tags as string[]).includes('auto:can-sale'),
  },
  message: { id: message.id, content: message.content ?? '', isSelf: false },
}).catch((err) => logger.error('[ai/kb] auto-reply hook failed', err));
```

- [ ] **Step 4: Build check toàn backend**

Run: `cd backend && npx tsc --noEmit 2>&1 | head -30`
Expected: không lỗi type. (Sửa các điểm ĐIỀU CHỈNH cho tới khi sạch.)

- [ ] **Step 5: Chạy toàn bộ test knowledge**

Run: `cd backend && npx vitest run src/modules/ai/knowledge/`
Expected: tất cả PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/ai/knowledge/auto-reply-wiring.ts backend/src/modules/ai/ai-virtual-chat-service.ts backend/src/modules/chat/message-handler.ts
git commit -m "feat(ai/kb): wire RAG into suggestions (flow A) + auto-reply hook (flow B)"
```

---

## Task 10: RLS policy + tài liệu + tổng kiểm

**Files:**
- Modify: `backend/prisma/rls/tenant-rls.sql`
- Create: `backend/src/modules/ai/knowledge/README.md`

- [ ] **Step 1: Thêm RLS policy 2 bảng mới**

Đọc `tenant-rls.sql` xem pattern một bảng org-scoped (vd cách set policy dùng `set_config('app.current_org', ...)`). Thêm policy tương tự cho `knowledge_documents` và `knowledge_chunks` (USING `org_id = current_setting('app.current_org')::...`). Copy đúng pattern bảng có sẵn.

> **Lưu ý:** nếu repo áp RLS qua migration tự động, thêm policy vào file SQL được apply. Nếu chưa chắc cơ chế, đọc đầu `tenant-rls.sql` (có ghi chú cách chạy) và làm theo. KHÔNG bỏ qua — bảng KB chứa dữ liệu org, phải có RLS như các bảng khác.

- [ ] **Step 2: Viết README**

`backend/src/modules/ai/knowledge/README.md` (tóm tắt: mục đích, ingest API, config AiConfig — kbEnabled/autoReplyEnabled/threshold/embed*, cách test local với Ollama bge-m3, compliance zca-js, trỏ spec). Nội dung tối thiểu:

```markdown
# AI Knowledge Base (RAG)

RAG cho module AI: ingest tài liệu DN → embed → lưu (Postgres Float[], không pgvector) → khi có tin
khách, search KB + LLM sinh trả lời. Spec: `docs/superpowers/specs/2026-06-28-ai-knowledge-base-rag-design.md`.

## Config (AiConfig, per-org)
- kbEnabled: bật RAG làm giàu gợi ý sale (flow A). Mặc định false.
- autoReplyEnabled: bật tự gửi tin khách thật (flow B). Mặc định false.
- autoReplyConfidenceThreshold (0.7), autoReplyTagOnHandoff (auto:can-sale)
- embedProvider (local) / embedModel (bge-m3) / embedBaseUrl (http://localhost:11434/v1)

## Ingest
POST /api/v1/ai/knowledge {title, content} (X-Api-Key). Cần embedding endpoint chạy.
Local test: Ollama + `ollama pull bge-m3`.

## Compliance
Auto-reply chạy trên tài khoản Zalo cá nhân (zca-js) → rủi ro khóa nick. autoReplyEnabled mặc định
TẮT; bật dần. Chỉ trả lời tin inbound. Quyết định gửi ở code, lỗi → handoff.
```

- [ ] **Step 3: Tổng kiểm — build + tất cả test**

Run:
```bash
cd backend && npx tsc --noEmit && npx vitest run src/modules/ai/knowledge/
```
Expected: build sạch; tất cả test knowledge PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/rls/tenant-rls.sql backend/src/modules/ai/knowledge/README.md
git commit -m "feat(ai/kb): RLS policy for KB tables + module README"
```

- [ ] **Step 5: Đẩy branch (chỉ khi user yêu cầu)**

```bash
git push -u origin feat/ai-knowledge-base
```

---

## Self-Review (đã thực hiện)

**1. Spec coverage:**
- §2 kiến trúc khối knowledge/ → Task 1-10. ✅
- §3 data model (Float[], embedProvider/Model/Dim) → Task 0. ✅
- §3.3 tái dùng AiSuggestion → Task 7/9 (recordSuggestion, alreadyHandled). ✅
- §4 embedding provider-agnostic (local/openai/gemini) → Task 3. ✅
- §5.1 luồng A chèn KB vào prompt → Task 9 Step 1. ✅
- §5.2 luồng B hook + 5 bước → Task 7 (logic) + Task 9 Step 3 (cắm). ✅
- §5.3 quyết định ở code, chống bịa, idempotency, double-reply, lỗi→handoff → Task 7 (ma trận 10 case). ✅
- §5.4 sendMessage thật → Task 9 wiring. ✅
- §6 config AiConfig → Task 0 Step 4. ✅
- §7 API endpoints → Task 8. ✅
- §8 error handling → Task 6 (ingest throw), Task 7 (handoff mọi lỗi). ✅
- §9 testing → mỗi task có test; ma trận quyết định Task 7. ✅
- §10 compliance → Task 10 README. ✅
- §3.4 migration + RLS → Task 0 Step 5, Task 10 Step 1. ✅

**2. Placeholder scan:** Mọi step code có code thật. Các điểm "ĐIỀU CHỈNH" (đường dẫn prisma, field AiSuggestion, hàm key per-org) là chỉ-dẫn-khớp-source có cơ sở (tên thật chỉ biết khi đọc model cụ thể), KHÔNG phải TODO mơ hồ — logic + test đã cố định, chỉ tên symbol ngoại vi cần khớp. Không có "add error handling" chung chung.

**3. Type consistency:**
- `cosine` (Task 1) dùng trong `rankChunks` (Task 4). ✅
- `chunkText` (Task 2) + `generateEmbedding`/`EmbedOpts` (Task 3) dùng trong knowledge-service (Task 6). ✅
- `Hit`/`rankChunks` (Task 4) → knowledge-service.searchKnowledge (Task 6). ✅
- `buildRagSystemPrompt`/`parseRagReply`/`decideAction`/`RagReply` (Task 5) → ai-auto-reply-hook (Task 7). ✅
- `onIncomingMessageHook`/`HookDeps`/`HookInput` (Task 7) → auto-reply-wiring (Task 9). ✅
- `ingestDocument`/`searchKnowledge`/`EmbedConfig`/`PrismaLike` (Task 6) → knowledge-routes (Task 8) + wiring (Task 9). ✅
- AiConfig fields (Task 0) → embedConfigForOrg (Task 8) + wiring (Task 9). ✅
