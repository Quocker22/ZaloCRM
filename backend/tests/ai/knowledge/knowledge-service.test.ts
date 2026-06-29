// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest';
import { ingestDocument, searchKnowledge } from '../../../src/modules/ai/knowledge/knowledge-service.js';

const cfg = { provider: 'local', model: 'bge-m3', baseUrl: 'http://x/v1' };

function fakeDeps() {
  const created: any[] = [];
  const prisma = {
    knowledgeDocument: { create: vi.fn(async ({ data }: any) => ({ id: 'doc1', ...data })) },
    knowledgeChunk: {
      createMany: vi.fn(async ({ data }: any) => {
        created.push(...data);
        return { count: data.length };
      }),
      findMany: vi.fn(async () =>
        created.map((c, i) => ({ id: `c${i}`, content: c.content, embedding: c.embedding, embedDim: c.embedDim })),
      ),
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

  it('HYBRID: bù chunk khớp từ khóa mà vector bỏ sót (vd "matrix")', async () => {
    // 3 chunk: 2 cái dài (vector kéo lên top), 1 cái ngắn chứa "matrix" (vector bỏ sót).
    const { deps } = fakeDeps();
    await ingestDocument(
      deps,
      'org1',
      { title: 'kb', content: 'Led dây ziczac trắng dài dài dài dài.\n\nLed neon cam dài dài dài dài.\n\nCard ST Matrix.' },
      cfg,
    );
    // topK=2 → vector chỉ lấy 2 chunk dài; lexical phải chèn chunk "matrix" vào.
    const hits = await searchKnowledge(deps, 'org1', 'cho anh led matrix coi', 2, cfg);
    expect(hits.some((h) => h.content.includes('Matrix'))).toBe(true);
  });

  it('HYBRID: query không có từ khóa đặc trưng → không chèn thừa', async () => {
    const { deps } = fakeDeps();
    await ingestDocument(deps, 'org1', { title: 'kb', content: 'Led dây ziczac.\n\nLed neon cam.' }, cfg);
    // chỉ toàn stopword ("cho anh xem có gì") → không lexical term → giữ nguyên top-K vector.
    const hits = await searchKnowledge(deps, 'org1', 'cho anh xem có gì', 1, cfg);
    expect(hits.length).toBe(1);
  });
});
