// SPDX-License-Identifier: AGPL-3.0-or-later
// Làm giàu KB: đọc product-specs/_specs.jsonl (spec crawl từ lednelia.com), match với chunk KB
// theo TÊN sản phẩm (token overlap ≥60%), THÊM block Mô tả/Thông số/Ứng dụng vào chunk, re-embed.
// An toàn: chỉ thêm block nếu chunk CHƯA có (idempotent, chạy lại không nhân đôi). Backup trước.
//   DATABASE_URL=... node --env-file=.env --import tsx scripts/enrich-kb-specs.ts [--dry]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../src/shared/database/prisma-client.js';
import { generateEmbedding } from '../src/modules/ai/knowledge/embedding.js';

const ORG = 'e26c70db-ec4a-4853-a726-0072c1dc936b';
const SPECS_FILE = join(dirname(fileURLToPath(import.meta.url)), '../product-specs/_specs.jsonl');
const DRY = process.argv.includes('--dry');
const MARKER = 'Thông số (theo mô tả sản phẩm';

interface Spec { ten: string; mota?: string; thongso?: string; ungdung?: string }

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9à-ỹ]+/g, ' ').split(' ').filter((t) => t.length >= 2),
  );
}
function nameFromChunk(c: string): string {
  return (c.match(/Tên sản phẩm:\s*(.+)/) ?? [])[1]?.trim() ?? '';
}
// Token PHÂN BIỆT quan trọng: điện áp (12v/220v/24v/5v), nhiệt độ màu (11000k/12000k...),
// trong/ngoài nhà. Nếu spec và chunk MÂU THUẪN ở các token này → KHÔNG phải cùng SP.
const VOLT_RE = /\b(5v|12v|24v|220v)\b/g;
const KELVIN_RE = /\b(\d{4,5}k)\b/g;
const PIXEL_RE = /\bp(\d{1,2}(?:\.\d)?)\b/g; // pitch module P4/P5/P10... — khác pitch = khác SP
function distinct(s: string, re: RegExp): Set<string> {
  return new Set((s.toLowerCase().match(re) ?? []));
}
function conflicts(a: Set<string>, b: Set<string>): boolean {
  // cả 2 đều có giá trị nhưng KHÔNG giao nhau → mâu thuẫn
  if (a.size && b.size && ![...a].some((x) => b.has(x))) return true;
  return false;
}
function inout(s: string): 'in' | 'out' | '' {
  const t = s.toLowerCase();
  if (/ngoài trời|ngoai troi|outdoor/.test(t)) return 'out';
  if (/trong nhà|trong nha|indoor/.test(t)) return 'in';
  return '';
}
/** Loại SP thô — thanh/dây/module/nguồn/card... KHÁC loại thì chắc chắn khác SP. */
function kind(s: string): string {
  const t = s.toLowerCase();
  if (/led thanh|thanh toả|thanh toa/.test(t)) return 'thanh';
  if (/led dây|led day|ziczac|neon/.test(t)) return 'dây';
  if (/nguồn|nguon|adapter/.test(t)) return 'nguồn';
  if (/module|cabin|p10|p8|p6|p5|p4|p3|p16|p20/.test(t)) return 'module';
  if (/card|mạch|mach|bộ xử lý|bo xu ly|ovp|full master/.test(t)) return 'mạch';
  if (/cảm biến|cam bien/.test(t)) return 'cảm biến';
  if (/dây điện|day dien|cáp|jack|đầu|dau |kìm|kim |ốc|thanh nhôm/.test(t)) return 'phụ kiện';
  return '';
}

/**
 * Điểm khớp tên spec↔chunk (0..1), 0 nếu MÂU THUẪN token phân biệt (điện áp/kelvin/trong-ngoài).
 * Chống gán nhầm thông số cho biến thể khác (11000K vs 12000K, 12V vs 220V, trong vs ngoài nhà).
 */
function match(specName: string, chunkName: string): number {
  const sk = kind(specName), ck = kind(chunkName);
  if (sk && ck && sk !== ck) return 0; // khác LOẠI (thanh vs dây vs nguồn...) → chắc chắn khác SP
  if (conflicts(distinct(specName, VOLT_RE), distinct(chunkName, VOLT_RE))) return 0;
  if (conflicts(distinct(specName, KELVIN_RE), distinct(chunkName, KELVIN_RE))) return 0;
  if (conflicts(distinct(specName, PIXEL_RE), distinct(chunkName, PIXEL_RE))) return 0; // P4≠P5≠P10
  const si = inout(specName), ci = inout(chunkName);
  if (si && ci && si !== ci) return 0; // trong nhà vs ngoài trời → khác SP
  const s = tokens(specName), c = tokens(chunkName);
  if (!s.size) return 0;
  return [...s].filter((t) => c.has(t)).length / s.size;
}

function specBlock(sp: Spec): string {
  const lines: string[] = [];
  if (sp.mota) lines.push(`Mô tả: ${sp.mota}`);
  if (sp.thongso) lines.push(`${MARKER}, kỹ thuật xác nhận chính xác khi chốt): ${sp.thongso}`);
  if (sp.ungdung) lines.push(`Ứng dụng: ${sp.ungdung}`);
  return lines.join('\n');
}

async function main() {
  const specs = readFileSync(SPECS_FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Spec);
  console.log(`Đọc ${specs.length} spec.`);
  const chunks = await prisma.knowledgeChunk.findMany({
    where: { orgId: ORG, content: { contains: 'Tên sản phẩm:' } },
    select: { id: true, content: true },
  });
  console.log(`${chunks.length} chunk sản phẩm trong KB.`);

  const embedCfg = { provider: 'local', model: 'bge-m3', baseUrl: 'http://localhost:11434/v1' };
  const usedChunks = new Set<string>(); // 1 chunk chỉ nhận 1 spec (chống 3 spec dồn vào 1 chunk)
  let enriched = 0, skippedHave = 0, noMatch = 0;

  for (const sp of specs) {
    // tìm chunk khớp tên tốt nhất (≥72%, CHƯA có spec, CHƯA bị spec khác chiếm)
    let best: { id: string; content: string; score: number } | null = null;
    for (const ch of chunks) {
      if (usedChunks.has(ch.id) || ch.content.includes(MARKER)) continue;
      const score = match(sp.ten, nameFromChunk(ch.content));
      if (score >= 0.68 && (!best || score > best.score)) best = { id: ch.id, content: ch.content, score };
    }
    if (!best) { noMatch++; console.log(`  ✗ không match chắc: ${sp.ten.slice(0, 45)}`); continue; }
    usedChunks.add(best.id);

    const block = specBlock(sp);
    if (!block) continue;
    const newContent = `${best.content.trimEnd()}\n${block}`;
    console.log(`  ✓ ${sp.ten.slice(0, 42)} → chunk "${nameFromChunk(best.content).slice(0, 42)}" (khớp ${Math.round(best.score * 100)}%)`);
    if (DRY) { enriched++; continue; }
    const [vec] = await generateEmbedding({ ...embedCfg, texts: [newContent] });
    await prisma.knowledgeChunk.update({ where: { id: best.id }, data: { content: newContent, embedding: vec } });
    // chunk đã sửa → cập nhật bản in-memory để lần match sau không chọn lại
    best.content = newContent;
    const idx = chunks.findIndex((c) => c.id === best!.id);
    if (idx >= 0) chunks[idx].content = newContent;
    enriched++;
  }
  console.log(`\n===== ${DRY ? '[DRY] ' : ''}Làm giàu ${enriched} chunk | ${skippedHave} đã có spec | ${noMatch} không match =====`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
