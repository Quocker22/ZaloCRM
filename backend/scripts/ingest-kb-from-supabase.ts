// SPDX-License-Identifier: AGPL-3.0-or-later
// Nạp KB cho 1 org từ website (Supabase service_pages + blog_posts). Tách chunk + embed bge-m3.
// Tái dùng cho mọi DN có website Supabase. Idempotent theo title (xoá document cũ cùng title trước).
//   SUPA_URL=... SUPA_KEY=... ORG_ID=... node --env-file=.env --import tsx scripts/ingest-kb-from-supabase.ts
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/shared/database/prisma-client.js';
import { generateEmbedding } from '../src/modules/ai/knowledge/embedding.js';

const SUPA_URL = process.env.SUPA_URL!;
const SUPA_KEY = process.env.SUPA_KEY!;
const ORG_ID = process.env.ORG_ID!;
const EMBED_CFG = { provider: 'local', model: 'bge-m3', baseUrl: 'http://localhost:11434/v1' };

function stripHtml(s: string): string {
  return (s || '')
    .replace(/<\/(p|div|li|br|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;/g, '–').replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

/** Tách nội dung dài thành chunk ~500 ký tự theo đoạn (giữ ngữ cảnh). */
function chunkText(text: string, max = 600): string[] {
  const paras = text.split('\n').map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = '';
  for (const p of paras) {
    if ((cur + '\n' + p).length > max && cur) { chunks.push(cur); cur = p; }
    else cur = cur ? cur + '\n' + p : p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function fetchTable(table: string, cols: string): Promise<any[]> {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}?select=${cols}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  if (!res.ok) { console.warn(`  ⚠ ${table}: HTTP ${res.status}`); return []; }
  return (await res.json()) as any[];
}

async function main() {
  if (!SUPA_URL || !SUPA_KEY || !ORG_ID) { console.error('Thiếu SUPA_URL/SUPA_KEY/ORG_ID'); process.exit(1); }

  // 1. Lấy nội dung website
  const services = await fetchTable('service_pages', 'title,slug,excerpt,content');
  const blogs = await fetchTable('blog_posts', 'title,slug,excerpt,content');
  console.log(`Lấy được ${services.length} dịch vụ + ${blogs.length} blog.`);

  const items = [
    ...services.map((s) => ({ title: s.title, body: [s.excerpt, stripHtml(s.content)].filter(Boolean).join('\n'), kind: 'Dịch vụ' })),
    ...blogs.map((b) => ({ title: b.title, body: [b.excerpt, stripHtml(b.content)].filter(Boolean).join('\n'), kind: 'Bài viết' })),
  ].filter((it) => it.title && it.body && it.body.length > 30);

  // 2. Xoá KB cũ của org (nạp lại sạch)
  await prisma.knowledgeChunk.deleteMany({ where: { orgId: ORG_ID } });
  await prisma.knowledgeDocument.deleteMany({ where: { orgId: ORG_ID } });
  console.log('Đã xoá KB cũ của org.');

  // 3. Nạp từng bài → document + chunks (embed)
  let totalChunks = 0;
  for (const it of items) {
    const docId = randomUUID();
    const fullContent = `Loại tài liệu: ${it.kind}\nTiêu đề: ${it.title}\n${it.body}`;
    await prisma.knowledgeDocument.create({
      data: { id: docId, orgId: ORG_ID, title: it.title, content: fullContent },
    });
    const chunks = chunkText(fullContent);
    for (let i = 0; i < chunks.length; i++) {
      const [vec] = await generateEmbedding({ ...EMBED_CFG, texts: [chunks[i]] });
      await prisma.knowledgeChunk.create({
        data: {
          id: randomUUID(), orgId: ORG_ID, documentId: docId, content: chunks[i], embedding: vec, ord: i,
          embedProvider: 'local', embedModel: 'bge-m3', embedDim: vec.length,
        },
      });
      totalChunks++;
    }
    console.log(`  ✓ ${it.title.slice(0, 50)} → ${chunks.length} chunk`);
  }

  console.log(`\n===== Nạp KB xong: ${items.length} tài liệu, ${totalChunks} chunk cho org ${ORG_ID.slice(0, 12)} =====`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
