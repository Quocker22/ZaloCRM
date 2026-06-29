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
  chunkRunes: number = CHUNK_RUNES,
): Promise<{ documentId: string; chunks: number }> {
  const chunks = chunkText(doc.content, chunkRunes);
  const document = await deps.prisma.knowledgeDocument.create({
    data: { orgId, title: doc.title, source: doc.source ?? 'upload', content: doc.content },
  });
  if (chunks.length === 0) return { documentId: document.id, chunks: 0 };
  // Embed BEFORE writing chunks, so an embedding failure doesn't leave half-written rows.
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

// Từ dừng/quá chung — không dùng làm khóa lexical (tránh match tràn lan).
const LEXICAL_STOP = new Set([
  'led', 'đèn', 'shop', 'em', 'anh', 'chị', 'cho', 'coi', 'xem', 'có', 'không', 'ko', 'giá',
  'bao', 'nhiêu', 'loại', 'dòng', 'mẫu', 'cái', 'của', 'là', 'nha', 'ạ', 'với', 'và', 'mua',
  'bán', 'cần', 'tư', 'vấn', 'này', 'kia', 'đó', 'thì', 'mà', 'ở', 'về',
]);

/**
 * Token đặc trưng trong query để bổ trợ tìm theo TỪ KHÓA (lexical), bù cho việc
 * vector search bỏ sót khớp tên/mã sản phẩm hiếm (vd "matrix", "P10", "ziczac").
 * Lấy token ≥3 ký tự, không phải stopword.
 */
function lexicalTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-zà-ỹ0-9]+/i)
    .filter((w) => w.length >= 3 && !LEXICAL_STOP.has(w));
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
  const vectorHits = rankChunks(queryVec, rows, topK);

  // HYBRID: bù chunk khớp TỪ KHÓA đặc trưng mà vector search bỏ sót (vd khách hỏi
  // "led matrix" nhưng embedding không kéo "Card điều khiển ST Matrix" lên top-K).
  const terms = lexicalTerms(query);
  if (terms.length === 0) return vectorHits;
  const seen = new Set(vectorHits.map((h) => h.chunkId));
  const lexHits: Hit[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    const lc = r.content.toLowerCase();
    if (terms.some((t) => lc.includes(t))) {
      lexHits.push({ chunkId: r.id, content: r.content, score: 0 });
      if (lexHits.length >= topK) break;
    }
  }
  if (lexHits.length === 0) return vectorHits;
  // Giữ chunk vector tốt nhất + chèn vài chunk lexical (tổng tối đa topK + 3, đủ ngữ cảnh).
  return [...vectorHits, ...lexHits].slice(0, topK + 3);
}
