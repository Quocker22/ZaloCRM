// SPDX-License-Identifier: AGPL-3.0-or-later
// TRA THỬ TRI THỨC — chạy tool `tra_tri_thuc` THẬT trên container prod.
//
// Vì sao tồn tại: sau khi nạp tài liệu, đếm số chunk trong DB KHÔNG chứng minh
// được bot tra ra. Chunk có thể sai orgId, embedding có thể lệch chiều, hoặc
// hàng rào chặn giá có thể nuốt sạch kết quả — DB vẫn đếm đủ như thường.
// Bug thật 11/08: bot đáp "Em ghi nhận rồi ạ" cho 8 PDF mà không nạp gì; bài
// học là phải chạy đúng đường đi thật rồi mới dám báo xong.
//
// Script này đi ĐÚNG đường của bot: searchKnowledge (hybrid vector+lexical)
// → traTriThuc (2 hàng rào giá) → dinhDangTriThuc, dùng embedding per-org
// trong DB. Ra chữ nào là bot thấy đúng chữ đó.
//
// CHẠY (trong container):
//   node scripts/tra-thu-tri-thuc.mjs --org=<orgId> "câu hỏi 1" "câu hỏi 2" ...
import { prisma } from '../dist/shared/database/prisma-client.js';
import { searchKnowledge } from '../dist/modules/ai/knowledge/knowledge-service.js';
import { generateEmbedding } from '../dist/modules/ai/knowledge/embedding.js';
import { resolveProviderApiKey } from '../dist/modules/ai/provider-registry.js';
import { traTriThuc } from '../dist/modules/ai/odoo/tools/tra-tri-thuc.js';

const orgId = (process.argv.find((a) => a.startsWith('--org=')) ?? '').slice(6);
const cauHoi = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!orgId || cauHoi.length === 0) {
  console.error('Dùng: node scripts/tra-thu-tri-thuc.mjs --org=<orgId> "câu hỏi" ...');
  process.exit(1);
}

const cfgOrg = await prisma.aiConfig.findUnique({ where: { orgId } });
if (!cfgOrg) { console.error(`Không có aiConfig cho org ${orgId}`); process.exit(1); }
const apiKey = await resolveProviderApiKey(orgId, cfgOrg.embedProvider);
const cfg = {
  provider: cfgOrg.embedProvider,
  model: cfgOrg.embedModel,
  baseUrl: cfgOrg.embedBaseUrl,
  ...(apiKey ? { apiKey } : {}),
};

// Gemini free tier chặn theo phút — tra thử mà dính 429 thì CHỜ, đừng báo
// "không tra ra" (kết luận sai sẽ khiến người ta đi sửa nhầm chỗ).
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

// Map chunk → tài liệu, để biết đoạn tra ra thuộc PDF nào (bằng chứng thật
// rằng đoạn đến từ tài liệu vừa nạp, không phải tri thức cũ trùng chữ).
const chunkToDoc = new Map();
for (const c of await prisma.knowledgeChunk.findMany({
  where: { orgId },
  select: { id: true, content: true, document: { select: { title: true, source: true } } },
})) {
  chunkToDoc.set(c.content.trim().slice(0, 120), `${c.document.title} [${c.document.source}]`);
}

for (const q of cauHoi) {
  console.log(`\n=== HỎI: ${q}`);
  const kq = await traTriThuc(
    { timDoan: (cauHoi, soDoan) => searchKnowledge(deps, orgId, cauHoi, soDoan, cfg) },
    { cau_hoi: q },
  );
  if (kq.loai !== 'ok') { console.log(`KẾT QUẢ: ${kq.loai}${kq.tuKhoa ? ` (${kq.tuKhoa})` : ''}`); continue; }
  for (const [i, d] of kq.doan.entries()) {
    const nguon = chunkToDoc.get(d.noiDung.replace(/…$/, '').trim().slice(0, 120)) ?? '?';
    console.log(`[${i + 1}] điểm=${d.diem.toFixed(3)} nguồn=${nguon}`);
    console.log(`    ${d.noiDung.replace(/\s+/g, ' ').slice(0, 220)}`);
  }
}
process.exit(0);
