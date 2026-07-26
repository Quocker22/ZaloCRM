// SPDX-License-Identifier: AGPL-3.0-or-later
// Re-ingest KB: xóa toàn bộ document/chunk cũ của org, ingest catalog mới.
import { readFileSync } from 'node:fs';
import { prisma } from '../src/shared/database/prisma-client.js';
import { generateEmbedding } from '../src/modules/ai/knowledge/embedding.js';
import { ingestDocument, type IngestDeps } from '../src/modules/ai/knowledge/knowledge-service.js';

async function main() {
  const orgId = process.argv[2];
  const file = process.argv[3];
  if (!orgId || !file) { console.error('usage: tsx scripts/kb-reingest.ts <orgId> <file>'); process.exit(1); }

  // Xóa KB cũ (chunk cascade theo document)
  const delDocs = await prisma.knowledgeDocument.deleteMany({ where: { orgId } });
  console.log(`xóa ${delDocs.count} document cũ`);

  const content = readFileSync(file, 'utf8');
  const deps: IngestDeps = { prisma: prisma as unknown as IngestDeps['prisma'], embed: generateEmbedding };
  const cfg = { provider: 'local', model: 'bge-m3', baseUrl: 'http://localhost:11434/v1' };
  console.time('ingest');
  // chunkRunes=250: mỗi block sản phẩm (~197 ký tự) thành 1 chunk riêng → retrieve chính xác (codex).
  const res = await ingestDocument(deps, orgId, { title: 'Catalog LEDNELIA (giá + nhóm + tồn)', source: 'upload', content }, cfg, 250);
  console.timeEnd('ingest');
  console.log('ingested:', res);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
