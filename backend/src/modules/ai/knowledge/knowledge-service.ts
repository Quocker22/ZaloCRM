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
