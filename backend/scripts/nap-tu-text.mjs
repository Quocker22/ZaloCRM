// SPDX-License-Identifier: AGPL-3.0-or-later
// NẠP TRI THỨC TỪ FILE TEXT — bản container (chạy từ dist, như soat-bot.mjs).
//
// Vì sao tồn tại: container KHÔNG có src + python3 nên nap-tri-thuc.ts (PDF)
// không chạy được trên server. Luồng chia đôi: trích text PDF ở máy dev
// (PyMuPDF) → đẩy .txt lên → script này chunk + embed + ghi KB, dùng đúng
// cấu hình embedding per-org trong DB (prod 08/08: gemini-embedding-001) nên
// vector mới cùng chiều với dữ liệu cũ.
//
// CHẠY (trong container):
//   node scripts/nap-tu-text.mjs <thư-mục-txt> --org=<orgId> [--nguon=data-led] [--xoa-cu]
import { readdirSync, readFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { prisma } from '../dist/shared/database/prisma-client.js';
import { ingestDocument } from '../dist/modules/ai/knowledge/knowledge-service.js';
import { generateEmbedding } from '../dist/modules/ai/knowledge/embedding.js';
import { resolveProviderApiKey } from '../dist/modules/ai/provider-registry.js';

const thuMuc = process.argv[2];
const orgId = (process.argv.find((a) => a.startsWith('--org=')) ?? '').slice(6);
const nguon = (process.argv.find((a) => a.startsWith('--nguon=')) ?? '--nguon=upload').slice(8);
const xoaCu = process.argv.includes('--xoa-cu');
if (!thuMuc || !orgId) {
  console.error('Dùng: node scripts/nap-tu-text.mjs <thư-mục-txt> --org=<orgId> [--nguon=x] [--xoa-cu]');
  process.exit(1);
}

// Cùng hàng rào với nap-tri-thuc.ts: giá nội bộ TUYỆT ĐỐI không vào KB.
const TU_KHOA_CAM = [
  'agent price', 'vip price', 'project price', 'giá vốn', 'gia von',
  'giá nhập', 'gia nhap', 'cost price', 'wholesale price',
];

const cfgOrg = await prisma.aiConfig.findUnique({ where: { orgId } });
if (!cfgOrg) { console.error(`Không có aiConfig cho org ${orgId}`); process.exit(1); }
const apiKey = await resolveProviderApiKey(orgId, cfgOrg.embedProvider);
const cfg = {
  provider: cfgOrg.embedProvider,
  model: cfgOrg.embedModel,
  baseUrl: cfgOrg.embedBaseUrl,
  ...(apiKey ? { apiKey } : {}),
};
console.log(`Embedding: ${cfg.provider}/${cfg.model} @ ${cfg.baseUrl}`);

if (xoaCu) {
  const cu = await prisma.knowledgeDocument.findMany({ where: { orgId, source: nguon }, select: { id: true } });
  if (cu.length > 0) {
    await prisma.knowledgeChunk.deleteMany({ where: { documentId: { in: cu.map((d) => d.id) } } });
    await prisma.knowledgeDocument.deleteMany({ where: { id: { in: cu.map((d) => d.id) } } });
    console.log(`Đã xoá ${cu.length} tài liệu cũ nguồn "${nguon}"`);
  }
}

// Gemini free tier giới hạn embedding theo phút — 429 thì CHỜ rồi thử lại,
// đừng chết giữa chừng (đo thật 08/08: chết sau 2 tài liệu).
const embedCoRetry = async (o) => {
  for (let lan = 1; ; lan++) {
    try {
      return await generateEmbedding(o);
    } catch (err) {
      const loi = err instanceof Error ? err.message : String(err);
      if (!loi.includes('429') || lan >= 6) throw err;
      console.log(`  … 429 quota — chờ 70s rồi thử lại (lần ${lan}/5)`);
      await new Promise((r) => setTimeout(r, 70_000));
    }
  }
};
const deps = { prisma, embed: embedCoRetry };
let tongChunk = 0;
for (const f of readdirSync(thuMuc).filter((f) => f.endsWith('.txt')).sort()) {
  const content = readFileSync(join(thuMuc, f), 'utf8');
  const thap = content.toLowerCase();
  const dinhCam = TU_KHOA_CAM.filter((c) => thap.includes(c));
  if (dinhCam.length > 0) { console.log(`BỎ ${f} — chứa từ khoá cấm: ${dinhCam.join(', ')}`); continue; }
  const title = basename(f, extname(f));
  // Chạy lại sau khi đứt giữa chừng: tài liệu nạp TRỌN (có chunk) mới bỏ qua.
  // Dòng document được tạo TRƯỚC khi embed — đứt lúc embed để lại dòng mồ côi
  // 0 chunk (đo thật 08/08 với E Catalog ONBON): phải xoá và nạp lại.
  const daCo = await prisma.knowledgeDocument.findFirst({ where: { orgId, source: nguon, title }, select: { id: true } });
  if (daCo) {
    const soChunk = await prisma.knowledgeChunk.count({ where: { documentId: daCo.id } });
    if (soChunk > 0) { console.log(`BỎ ${title} — đã nạp trước đó (${soChunk} chunk)`); continue; }
    await prisma.knowledgeDocument.delete({ where: { id: daCo.id } });
    console.log(`  … ${title}: dòng mồ côi 0 chunk — xoá, nạp lại`);
  }
  const kq = await ingestDocument(deps, orgId, { title, source: nguon, content }, cfg);
  tongChunk += kq.chunks;
  console.log(`OK  ${title}: ${kq.chunks} chunk (${content.length.toLocaleString()} ký tự)`);
}
console.log(`XONG — tổng ${tongChunk} chunk, nguồn "${nguon}".`);
process.exit(0);
