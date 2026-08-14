// SPDX-License-Identifier: AGPL-3.0-or-later
// ĐỒNG BỘ GOOGLE SHEET "Thông số sản phẩm" → KB + bảng ảnh (bản container, dist).
//
// Vòng quay: công ty điền thông số + dán link ảnh vào sheet → chạy script này →
//   1. Cột "Thông số kỹ thuật"/"Bảo hành"/"Ghi chú" → chunks KB (nguồn 'sheet',
//      xoá cũ nạp mới — idempotent). KHÔNG lấy cột Giá bán: giá phải tra Odoo,
//      giá sheet để lâu là giá cũ, bot nói giá sai còn tệ hơn không nói.
//   2. Cột "Link ảnh (phẩy)" → bảng anh_san_pham — luồng khách gửi nhiều ảnh/SP.
//
// CHẠY (trong container):
//   node scripts/dong-bo-sheet.mjs [--sheet=<url csv export>] [--org=<orgId>]
import { prisma } from '../dist/shared/database/prisma-client.js';
import { generateEmbedding } from '../dist/modules/ai/knowledge/embedding.js';
import { resolveProviderApiKey } from '../dist/modules/ai/provider-registry.js';

const SHEET_MAC_DINH =
  'https://docs.google.com/spreadsheets/d/1RygKKQMBOGkvYOjbfRA5YYTbJrE-_hKkF59EOu9eBO8/export?format=csv&gid=0';
const ORG_MAC_DINH = '23e58332-cc24-4dc7-9293-d938d5057147';
const sheetUrl = (process.argv.find((a) => a.startsWith('--sheet=')) ?? `--sheet=${SHEET_MAC_DINH}`).slice(8);
const orgId = (process.argv.find((a) => a.startsWith('--org=')) ?? `--org=${ORG_MAC_DINH}`).slice(6);

// Cùng hàng rào với nap-tri-thuc: giá nội bộ TUYỆT ĐỐI không vào KB.
const TU_KHOA_CAM = [
  'agent price', 'vip price', 'project price', 'giá vốn', 'gia von',
  'giá nhập', 'gia nhap', 'cost price', 'wholesale price',
];

/** Parse CSV có quote — sheet xuất chuẩn RFC. */
function parseCsv(text) {
  const dong = []; let hang = [], o = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { o += '"'; i++; }
      else if (c === '"') q = false;
      else o += c;
    } else if (c === '"') q = true;
    else if (c === ',') { hang.push(o); o = ''; }
    else if (c === '\n') { hang.push(o); dong.push(hang); hang = []; o = ''; }
    else if (c !== '\r') o += c;
  }
  if (o || hang.length) { hang.push(o); dong.push(hang); }
  return dong;
}

console.log(`Tải sheet: ${sheetUrl.slice(0, 80)}…`);
const res = await fetch(sheetUrl, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
if (!res.ok) { console.error(`Sheet trả HTTP ${res.status} — kiểm tra quyền share.`); process.exit(1); }
const rows = parseCsv(await res.text());
const body = rows.slice(1).filter((r) => r.length >= 9 && r[1]?.trim());
console.log(`Sheet: ${body.length} dòng sản phẩm`);

// Cột: 0 Mã · 1 Tên · 2 Đơn vị · 3 Giá(BỎ) · 4 Danh mục · 5 Thông số · 6 Bảo hành · 7 Ghi chú · 8 Link ảnh
const toanBo = body.map((r) => r.join(' ')).join(' ').toLowerCase();
const dinhCam = TU_KHOA_CAM.filter((c) => toanBo.includes(c));
if (dinhCam.length > 0) {
  console.error(`DỪNG — sheet chứa từ khoá giá nội bộ: ${dinhCam.join(', ')}. Gỡ khỏi sheet rồi chạy lại.`);
  process.exit(1);
}

// ── 1. KB: mỗi dòng có thông số = một chunk ────────────────────────────────
const chiAnh = process.argv.includes('--chi-anh');
if (!chiAnh) {
const chunks = [];
for (const r of body) {
  const [ma, ten, donVi, , danhMuc, thongSo, baoHanh, ghiChu] = r.map((c) => (c ?? '').trim());
  if (!thongSo && !baoHanh && !ghiChu) continue;
  chunks.push([
    `Tên sản phẩm: ${ten}${ma ? ` (mã ${ma})` : ''}`,
    donVi ? `Đơn vị: ${donVi}` : '',
    danhMuc && danhMuc !== 'All' ? `Danh mục: ${danhMuc}` : '',
    thongSo ? `Thông số kỹ thuật: ${thongSo}` : '',
    baoHanh ? `Bảo hành: ${baoHanh}` : '',
    ghiChu ? `Ghi chú: ${ghiChu}` : '',
  ].filter(Boolean).join('\n'));
}
console.log(`KB: ${chunks.length} sản phẩm có thông số`);

const cfgOrg = await prisma.aiConfig.findUnique({ where: { orgId } });
const apiKey = await resolveProviderApiKey(orgId, cfgOrg.embedProvider);
const cfg = { provider: cfgOrg.embedProvider, model: cfgOrg.embedModel, baseUrl: cfgOrg.embedBaseUrl, apiKey };
console.log(`Embedding: ${cfg.provider}/${cfg.model}`);

// Embed theo lô 40 chunk/lượt, 429 thì chờ thử lại (gemini free tier).
const vectors = [];
for (let b = 0; b < chunks.length; b += 40) {
  const lo = chunks.slice(b, b + 40);
  for (let lan = 1; ; lan++) {
    try {
      vectors.push(...(await generateEmbedding({ ...cfg, texts: lo })));
      break;
    } catch (err) {
      const loi = err instanceof Error ? err.message : String(err);
      if (!loi.includes('429') || lan >= 6) throw err;
      console.log(`  … 429 quota — chờ 70s (lô ${b / 40 + 1}, lần ${lan}/5)`);
      await new Promise((r) => setTimeout(r, 70_000));
    }
  }
  console.log(`  embed ${Math.min(b + 40, chunks.length)}/${chunks.length}`);
}

// Xoá bản cũ nguồn 'sheet' rồi ghi bản mới — một document, mỗi SP một chunk.
// A2 (14/08): xoá-cũ + ghi-mới trong MỘT transaction — chết giữa chừng thì
// rollback về bản cũ nguyên vẹn, không bao giờ ở trạng thái "đã xoá mà chưa
// ghi" (bot mất sạch thông số cho tới lần chạy sau). Dữ liệu mới (embeddings)
// đã dựng XONG ở trên rồi mới vào đây — transaction chỉ ôm phần ghi DB.
const cu = await prisma.knowledgeDocument.findMany({ where: { orgId, source: 'sheet' }, select: { id: true } });
const docId = await prisma.$transaction(async (tx) => {
  if (cu.length > 0) {
    await tx.knowledgeChunk.deleteMany({ where: { documentId: { in: cu.map((d) => d.id) } } });
    await tx.knowledgeDocument.deleteMany({ where: { id: { in: cu.map((d) => d.id) } } });
  }
  const doc = await tx.knowledgeDocument.create({
    data: {
      orgId, source: 'sheet',
      title: 'Thông số sản phẩm (Google Sheet — đồng bộ tự động)',
      content: chunks.join('\n\n'),
    },
  });
  await tx.knowledgeChunk.createMany({
    data: chunks.map((content, ord) => ({
      orgId, documentId: doc.id, ord, content,
      embedding: vectors[ord],
      embedProvider: cfg.provider, embedModel: cfg.model, embedDim: vectors[ord].length,
    })),
  });
  return doc.id;
// Trần 60s: mặc định Prisma 5s không đủ cho ~500 chunk kèm vector 768 chiều
// (đo prod 14/08: commit 5.3s đã nổ). maxWait 10s cho lúc pool bận.
}, { timeout: 60_000, maxWait: 10_000 });
if (cu.length > 0) console.log(`Đã thay ${cu.length} bản đồng bộ cũ (trong transaction)`);
console.log(`KB: đã ghi ${chunks.length} chunk (document ${docId})`);
}

// ── 2. Ảnh: cột Link ảnh → bảng anh_san_pham (thay trọn mỗi lần) ───────────
// Tên Odoo KHÔNG unique (đo thật 08/08: sheet có tên trùng) — gộp URL các
// dòng trùng tên vào một bản ghi, khử trùng lặp URL.
const anhTheoTen = new Map();
for (const r of body) {
  const ten = (r[1] ?? '').trim();
  const urls = (r[8] ?? '').split(',').map((u) => u.trim()).filter((u) => u.startsWith('http'));
  if (!ten || urls.length === 0) continue;
  const cu = anhTheoTen.get(ten) ?? [];
  anhTheoTen.set(ten, [...new Set([...cu, ...urls])].slice(0, 5));
}
const anh = [...anhTheoTen.entries()].map(([ten, urls]) => ({ orgId, ten, urls }));
// A2: cùng lý do — thay trọn trong một transaction, chết giữa chừng không mất ảnh.
await prisma.$transaction([
  prisma.anhSanPham.deleteMany({ where: { orgId } }),
  prisma.anhSanPham.createMany({ data: anh }),
]);
console.log(`Ảnh: ${anh.length} SP có link (${anh.reduce((t, a) => t + a.urls.length, 0)} URL)`);
console.log('ĐỒNG BỘ XONG.');
process.exit(0);
