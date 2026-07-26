import { readFileSync } from 'node:fs';
import { prisma } from '../src/shared/database/prisma-client.js';
import { generateEmbedding } from '../src/modules/ai/knowledge/embedding.js';
import { ingestDocument, type IngestDeps } from '../src/modules/ai/knowledge/knowledge-service.js';
async function main() {
  const [orgId, file, title] = process.argv.slice(2);
  const content = readFileSync(file, 'utf8');
  const deps: IngestDeps = { prisma: prisma as unknown as IngestDeps['prisma'], embed: generateEmbedding };
  const cfg = { provider: 'local', model: 'bge-m3', baseUrl: 'http://localhost:11434/v1' };
  const res = await ingestDocument(deps, orgId, { title, source: 'manual', content }, cfg, 400);
  console.log('appended:', res);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
