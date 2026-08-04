// SPDX-License-Identifier: AGPL-3.0-or-later
import { chunkText } from './chunk.js';
import { generateEmbedding } from './embedding.js';
import { rankChunks, type Hit } from './rank.js';
import { logger } from '../../../shared/utils/logger.js';

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
/**
 * Thuật ngữ VIỆT → từ tương ứng trong tài liệu (Anh/Trung).
 *
 * Bug thật 2026-08-04: tài liệu LEDNELIA là catalog tiếng Anh/Trung, khách hỏi
 * tiếng Việt. Hỏi "bảo hành đèn led mấy năm" thì lexical tách ra "bảo","hành"
 * — không chunk nào chứa, nên đoạn ghi "3 years warranty" không bao giờ được
 * kéo lên. Vector cũng trượt vì embedding đa ngữ vẫn ưu tiên chunk cùng ngôn
 * ngữ với câu hỏi.
 *
 * CHỈ thêm thuật ngữ KỸ THUẬT hay hỏi. Không dịch tràn lan — mỗi từ thêm vào
 * là một cách match sai.
 */
const DONG_NGHIA: Record<string, string[]> = {
  'bảo': ['warranty', '保修'],
  'hành': ['warranty', '保修'],
  'chống': ['proof', 'resistant', 'ip6', 'ip5'],
  'nước': ['waterproof', 'ip6', 'ip5'],
  'công': ['power', 'watt'],
  'suất': ['power', 'watt'],
  'điện': ['voltage', 'power', 'dc', 'ac'],
  'áp': ['voltage', 'dc', 'ac'],
  'nhiệt': ['temperature', 'kelvin'],
  'độ': ['temperature', 'angle', 'degree'],
  'góc': ['angle', 'beam'],
  'sáng': ['lumen', 'brightness', 'luminous'],
  'tuổi': ['lifespan', 'lifetime'],
  'thọ': ['lifespan', 'lifetime'],
  'kích': ['size', 'dimension'],
  'thước': ['size', 'dimension'],
};

function lexicalTerms(query: string): string[] {
  const tu = query
    .toLowerCase()
    .split(/[^a-zà-ỹ0-9]+/i)
    .filter((w) => w.length >= 3 && !LEXICAL_STOP.has(w));
  // Bổ sung từ tương ứng — giữ cả từ gốc phòng khi tài liệu cũng có tiếng Việt.
  const them = tu.flatMap((w) => DONG_NGHIA[w] ?? []);
  return [...new Set([...tu, ...them])];
}

export async function searchKnowledge(
  deps: IngestDeps,
  orgId: string,
  query: string,
  topK: number,
  cfg: EmbedConfig,
): Promise<Hit[]> {
  const rows = await deps.prisma.knowledgeChunk.findMany({
    where: { orgId },
    select: { id: true, content: true, embedding: true, embedDim: true },
  });

  // Vector search — nhưng nếu embedding provider CHẾT/không cấu hình (vd không có Ollama,
  // provider không hỗ trợ /embeddings) thì đừng để cả KB search sập: rơi về LEXICAL-only.
  // Trước đây embed() throw → searchKnowledge throw → hook mất ngữ cảnh → bot im lặng.
  let vectorHits: Hit[] = [];
  try {
    const [queryVec] = await deps.embed({ ...cfg, texts: [query] });
    vectorHits = rankChunks(queryVec, rows, topK);
  } catch (err) {
    logger.warn('[kb] embedding lỗi, dùng lexical-only: %s', (err as Error).message);
    vectorHits = [];
  }

  // HYBRID: bù chunk khớp TỪ KHÓA đặc trưng mà vector search bỏ sót (vd khách hỏi
  // "led matrix" nhưng embedding không kéo "Card điều khiển ST Matrix" lên top-K).
  // Khi embedding chết (vectorHits rỗng) → đây thành nguồn kết quả DUY NHẤT.
  const terms = lexicalTerms(query);
  if (terms.length === 0) return vectorHits;
  const seen = new Set(vectorHits.map((h) => h.chunkId));
  const lexHits: Hit[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    const lc = r.content.toLowerCase();
    if (terms.some((t) => lc.includes(t))) {
      lexHits.push({ chunkId: r.id, content: r.content, score: 0 });
      if (lexHits.length >= topK + 3) break;
    }
  }
  if (lexHits.length === 0) return vectorHits;

  // TRỘN XEN KẼ, không nối đuôi.
  //
  // Bug thật 2026-08-04: nối đuôi (`[...vector, ...lex]`) khiến chunk khớp CHỮ
  // luôn nằm cuối. Caller thường cắt top-N nên chúng bị loại sạch — hỏi
  // "warranty" mà 3 chunk chứa đúng chữ "warranty" đều rớt, bot nhận 3 chunk
  // giới thiệu công ty rồi tự bịa số năm bảo hành.
  //
  // Xen kẽ 2 vector : 1 lexical — vector vẫn dẫn (nó hiểu ngữ nghĩa), nhưng
  // khớp chữ chắc chắn có mặt trong top-3.
  const tron: Hit[] = [];
  let iv = 0;
  let il = 0;
  while (iv < vectorHits.length || il < lexHits.length) {
    if (iv < vectorHits.length) tron.push(vectorHits[iv++]);
    if (iv < vectorHits.length) tron.push(vectorHits[iv++]);
    if (il < lexHits.length) tron.push(lexHits[il++]);
  }
  return tron.slice(0, topK + 3);
}
