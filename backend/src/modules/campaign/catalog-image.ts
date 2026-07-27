// SPDX-License-Identifier: AGPL-3.0-or-later
// Ghép 1 ẢNH CATALOG BÁO GIÁ cho chiến dịch hàng loạt: chọn top N sản phẩm CÓ GIÁ + CÓ ẢNH
// từ KB, xếp grid (ảnh SP + tên + giá) bằng sharp → 1 file PNG. Ghép 1 lần/chiến dịch (cache).
// Chống Zalo flag: 1 ảnh/khách thay vì nhiều ảnh rời.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { parsePriceFromChunk, formatVnd, type KbLookup } from '../ai/knowledge/order-checkout.js';

const IMG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../product-images');
const MATCH_FILE = join(IMG_DIR, '_kb_match.json');

export interface CatalogItem {
  name: string;
  price: number;
  imagePath: string;
}

interface MatchEntry {
  web: string;
  file: string;
  score: number;
}

/** Nhóm SP theo từ khoá đầu tên → catalog đa dạng (mỗi nhóm ≤ 2 SP, không trùng lặp). */
function groupOf(name: string): string {
  const n = name.toLowerCase();
  if (/nguồn|nguon|adapter/.test(n)) return 'nguồn';
  if (/led dây|led day|ziczac|neon/.test(n)) return 'led dây';
  if (/module|p10|p6|p4|p8/.test(n)) return 'module';
  if (/dây điện|day dien|cáp|jack|đầu nối|dau noi/.test(n)) return 'dây/phụ kiện';
  if (/led|bóng|bong|cob/.test(n)) return 'led';
  return 'khác';
}

/** Token hoá tên (bỏ dấu ngoặc/ký tự lạ, ≥2 ký tự) để so khớp. */
function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9à-ỹ]+/g, ' ').split(' ').filter((t) => t.length >= 2),
  );
}
/**
 * Tên KB có khớp CHÍNH XÁC tên query không (cho catalog báo giá — giá sai rất tệ nên siết chặt).
 * Yêu cầu overlap ≥80% theo CẢ HAI chiều: gần như trùng tên, không chỉ chung vài token.
 * Vd "Nguồn NC 12v300w" vs "Nguồn HQ 12V300W SID" → chung nguồn/12v300w nhưng khác NC/HQ/SID
 * → overlap 2 chiều thấp → REJECT (đúng, vì là 2 SP khác giá).
 */
function nameCloseEnough(query: string, resolvedName: string): boolean {
  const q = tokens(query);
  const r = tokens(resolvedName);
  if (q.size === 0 || r.size === 0) return false;
  const inter = [...q].filter((t) => r.has(t)).length;
  return inter / q.size >= 0.8 && inter / r.size >= 0.8;
}

function loadMatchMap(): Record<string, MatchEntry> {
  try {
    return JSON.parse(readFileSync(MATCH_FILE, 'utf8')) as Record<string, MatchEntry>;
  } catch {
    return {};
  }
}

/**
 * Chọn ≤ n SP có ẢNH (từ _kb_match.json) VÀ tra được GIÁ (KB search). Đa dạng nhóm:
 * mỗi nhóm ≤ maxPerGroup (mặc định co giãn theo n để lấy đủ nhiều SP). Duyệt theo score ảnh.
 */
export async function pickCatalogProducts(n: number, lookup: KbLookup): Promise<CatalogItem[]> {
  const map = loadMatchMap();
  const entries = Object.entries(map)
    .filter(([, v]) => v.file && existsSync(join(IMG_DIR, v.file)))
    .sort((a, b) => (b[1].score ?? 0) - (a[1].score ?? 0));

  // Trần mỗi nhóm co giãn theo n (~6 nhóm): n=9 → 2/nhóm; n=30 → 6/nhóm. Vẫn đa dạng, không đơn điệu.
  const maxPerGroup = Math.max(2, Math.ceil(n / 5));

  // BƯỚC 1: chọn ứng viên (dedup nhóm/ảnh/tên) — chưa tra giá. Lấy dư (3×n) để bù SP không có giá.
  const candidates: Array<{ kbName: string; dispName: string; entry: MatchEntry; group: string }> = [];
  const seenNames = new Set<string>();
  const seenFiles = new Set<string>();
  const perGroupC: Record<string, number> = {};
  for (const [kbName, entry] of entries) {
    if (candidates.length >= n * 3) break;
    const group = groupOf(kbName);
    if ((perGroupC[group] ?? 0) >= maxPerGroup * 2) continue;
    if (seenFiles.has(entry.file)) continue;
    const dispName = entry.web || kbName;
    if (seenNames.has(dispName.toLowerCase())) continue;
    candidates.push({ kbName, dispName, entry, group });
    perGroupC[group] = (perGroupC[group] ?? 0) + 1;
    seenFiles.add(entry.file);
    seenNames.add(dispName.toLowerCase());
  }

  // BƯỚC 2: tra giá SONG SONG (thay vì tuần tự — nhanh hơn nhiều, tránh treo ~100s).
  const priced = await Promise.all(
    candidates.map(async (c) => {
      try {
        const hits = await lookup(c.kbName);
        for (const h of hits) {
          const chunkName = (h.content.match(/Tên sản phẩm:\s*(.+)/) ?? [])[1]?.trim() ?? '';
          if (!nameCloseEnough(c.kbName, chunkName)) continue;
          const p = parsePriceFromChunk(h.content);
          if (p !== null) return { ...c, price: p };
        }
      } catch { /* bỏ qua SP lỗi */ }
      return { ...c, price: null as number | null };
    }),
  );

  // BƯỚC 3: lọc ra ≤ n SP hợp lệ (giữ thứ tự score, trần nhóm, chống giá phi lý/trùng).
  const picked: CatalogItem[] = [];
  const perGroup: Record<string, number> = {};
  const seenPrices = new Set<number>();
  for (const c of priced) {
    if (picked.length >= n) break;
    const price = c.price;
    if (!price || price <= 0) continue; // chưa có giá thật → bỏ
    if (price < priceFloor(c.group)) continue; // giá phi lý theo nhóm → bỏ
    if (seenPrices.has(price)) continue; // giá trùng → nhiều khả năng matcher nhầm → bỏ
    if ((perGroup[c.group] ?? 0) >= maxPerGroup) continue; // trần mỗi nhóm
    picked.push({ name: c.dispName, price, imagePath: join(IMG_DIR, c.entry.file) });
    perGroup[c.group] = (perGroup[c.group] ?? 0) + 1;
    seenPrices.add(price);
  }
  return picked;
}

/** Sàn giá hợp lý theo nhóm — chặn giá phi lý do KB bẩn (vd nguồn 300W bị gán 4.800đ). */
function priceFloor(group: string): number {
  switch (group) {
    case 'nguồn': return 20000; // nguồn rẻ nhất cũng ~50k; <20k chắc chắn sai
    case 'module': return 30000;
    default: return 0;
  }
}

// ── Ghép ảnh grid — khổ A4 DỌC (1240×1754 @150dpi) ─────────────────────────
// Canvas cố định khổ A4 (tỷ lệ 1:1.414) để in/gửi vừa 1 tờ giấy. 2 cột cho A4 dọc.
const A4_W = 1240; // A4 rộng @150dpi
const A4_H = 1754; // A4 cao @150dpi
const HEADER_H = 90;
const COLS = 3;
const PAD = 24;
const CAPTION_H = 70; // dải text dưới ảnh
// CELL tính từ chiều rộng A4: (A4_W - PAD*(COLS+1)) / COLS
const CELL = Math.floor((A4_W - PAD * (COLS + 1)) / COLS); // ≈ 568

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string));
}

/** SVG overlay: tên (rút gọn theo bề rộng ô) + giá đậm, căn giữa, không tràn mép. */
function captionSvg(name: string, price: number): Buffer {
  const maxChars = Math.floor((CELL - 20) / 9); // font 18px ≈ 9px/ký tự, chừa lề 20px
  const short = name.length > maxChars ? name.slice(0, maxChars - 1) + '…' : name;
  const svg = `<svg width="${CELL}" height="${CAPTION_H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#ffffff"/>
    <text x="${CELL / 2}" y="28" font-family="Arial, sans-serif" font-size="18" fill="#111827" text-anchor="middle">${escapeXml(short)}</text>
    <text x="${CELL / 2}" y="58" font-family="Arial, sans-serif" font-size="26" font-weight="bold" fill="#b91c1c" text-anchor="middle">${escapeXml(formatVnd(price))}</text>
  </svg>`;
  return Buffer.from(svg);
}

function headerSvg(width: number, title: string, pageInfo: string): Buffer {
  const svg = `<svg width="${width}" height="${HEADER_H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#1e3a8a"/>
    <text x="${width / 2}" y="48" font-family="Arial, sans-serif" font-size="36" font-weight="bold" fill="#ffffff" text-anchor="middle">${escapeXml(title)}</text>
    <text x="${width / 2}" y="76" font-family="Arial, sans-serif" font-size="18" fill="#cbd5e1" text-anchor="middle">${escapeXml(pageInfo)}</text>
  </svg>`;
  return Buffer.from(svg);
}

// Số SP mỗi trang A4: 2 cột × số hàng vừa chiều cao A4.
const CELL_H = CELL + CAPTION_H + PAD; // chiều cao 1 ô (ảnh vuông + caption + pad)
const ROWS_PER_PAGE = Math.floor((A4_H - HEADER_H - PAD) / CELL_H); // ≈ 2 hàng
const PER_PAGE = COLS * ROWS_PER_PAGE; // SP mỗi trang A4

/**
 * Ghép 1 TRANG A4 (canvas cố định A4_W×A4_H) từ ≤ PER_PAGE item → ghi PNG ra outPath.
 * Mỗi ô = ảnh SP vuông (cover) + caption (tên+giá) dưới. Vừa 1 tờ A4 dọc.
 */
export async function renderCatalogImage(items: CatalogItem[], title: string, outPath: string, pageInfo = ''): Promise<string> {
  const cellW = CELL + PAD;
  const composites: sharp.OverlayOptions[] = [];
  composites.push({ input: headerSvg(A4_W, title, pageInfo), top: 0, left: 0 });

  for (let i = 0; i < items.length && i < PER_PAGE; i++) {
    const it = items[i];
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PAD + col * cellW;
    const y = HEADER_H + PAD + row * CELL_H;
    let imgBuf: Buffer;
    try {
      imgBuf = await sharp(it.imagePath).resize(CELL, CELL, { fit: 'cover' }).png().toBuffer();
    } catch {
      imgBuf = await sharp({ create: { width: CELL, height: CELL, channels: 3, background: '#e5e7eb' } }).png().toBuffer();
    }
    composites.push({ input: imgBuf, top: y, left: x });
    composites.push({ input: captionSvg(it.name, it.price), top: y + CELL, left: x });
  }

  // Canvas cố định A4 dọc (dù trang cuối ít SP vẫn đủ khổ A4 để in vừa 1 tờ).
  await sharp({ create: { width: A4_W, height: A4_H, channels: 3, background: '#f3f4f6' } })
    .composite(composites)
    .png()
    .toFile(outPath);
  return outPath;
}

/** Ghép NHIỀU trang A4 từ danh sách SP: mỗi PER_PAGE SP → 1 file A4. Trả mảng đường dẫn. */
export async function renderCatalogPages(items: CatalogItem[], title: string, outPrefix: string): Promise<string[]> {
  const totalPages = Math.ceil(items.length / PER_PAGE);
  const paths: string[] = [];
  for (let p = 0; p < totalPages; p++) {
    const slice = items.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
    const out = `${outPrefix}-p${p + 1}.png`;
    await renderCatalogImage(slice, title, out, `Trang ${p + 1}/${totalPages}`);
    paths.push(out);
  }
  return paths;
}

// ── Cache theo org (RAM + TTL) ─────────────────────────────────────────────
interface CacheEntry {
  paths: string[];
  at: number;
}
const cache = new Map<string, CacheEntry>();
const TTL_MS = 6 * 60 * 60 * 1000; // 6h — SP/giá ít đổi, catalog không cần tươi từng phút.
                                   // Warm lúc boot + TTL dài → route prepare luôn trả cache tức thì.

const TARGET_PRODUCTS = 36; // tổng SP muốn có trong bộ catalog
const PER_IMAGE = 12; // mỗi ảnh tối đa 12 SP (grid 3×4) → 36 SP = 3 ảnh, gửi 1 batch

/**
 * Trả DANH SÁCH path ảnh catalog cho org (ghép ~TARGET_PRODUCTS SP, tách thành nhiều ảnh
 * ≤ PER_IMAGE/ảnh, cache 10 phút). [] nếu < 3 SP có giá+ảnh.
 * `now` truyền vào để test tất định (mặc định Date.now).
 */
export async function getCampaignCatalogs(
  orgId: string,
  shopName: string,
  _lookup: KbLookup, // giữ tham số cho tương thích; KHÔNG dùng nữa (xem dbLookup bên dưới)
  now: number = Date.now(),
): Promise<string[]> {
  const hit = cache.get(orgId);
  if (hit && now - hit.at < TTL_MS && hit.paths.every((p) => existsSync(p))) return hit.paths;

  // Giá NẰM SẴN trong text chunk KB ("Giá bán: X") → đọc THẲNG từ DB (1 query),
  // KHÔNG cần vector search/embedding (Ollama). Build INDEX tên-SP→chunk (O(1) tra),
  // tránh duyệt toàn bộ 212 chunk cho MỖI ứng viên (cũ = ~21k regex → treo).
  const { prisma } = await import('../../shared/database/prisma-client.js');
  const rows = await prisma.knowledgeChunk.findMany({ where: { orgId }, select: { content: true } });
  // Pre-tính token của TÊN mỗi chunk (1 lần) để tra nhanh. Tên trong _kb_match.json
  // khác tên chunk (fuzzy) nên KHÔNG exact-match được → lọc theo token CHUNG (mã model/số).
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const chunkToks = rows.map((r) => {
    const nm = (r.content.match(/Tên sản phẩm:\s*(.+)/) ?? [])[1]?.trim() ?? '';
    const toks = new Set(norm(nm).split(/[^a-z0-9]+/).filter((t) => t.length >= 2));
    return { content: r.content, toks };
  });
  const dbLookup: KbLookup = async (q: string) => {
    const qToks = norm(q).split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
    if (!qToks.length) return [];
    // chunk có ≥1 token trùng tên query → ứng viên (nameCloseEnough trong pick lọc tiếp).
    // ưu tiên chunk trùng NHIỀU token (khớp tên tốt hơn).
    return chunkToks
      .map((c) => ({ c, overlap: qToks.filter((t) => c.toks.has(t)).length }))
      .filter((x) => x.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 6)
      .map((x) => ({ content: x.c.content }));
  };

  const items = await pickCatalogProducts(TARGET_PRODUCTS, dbLookup);
  if (items.length < 3) return []; // không đủ SP để làm catalog

  const totalPages = Math.ceil(items.length / PER_IMAGE);
  const paths: string[] = [];
  for (let page = 0; page < totalPages; page++) {
    const slice = items.slice(page * PER_IMAGE, (page + 1) * PER_IMAGE);
    const title =
      totalPages > 1
        ? `BẢNG GIÁ THAM KHẢO — ${shopName} (${page + 1}/${totalPages})`
        : `BẢNG GIÁ THAM KHẢO — ${shopName}`;
    const outPath = join(tmpdir(), `catalog-${orgId}-${now}-${page}.png`);
    await renderCatalogImage(slice, title, outPath);
    paths.push(outPath);
  }
  cache.set(orgId, { paths, at: now });
  return paths;
}

/** Tương thích ngược: trả 1 ảnh (ảnh đầu). Dùng nơi chỉ cần 1. */
export async function getCampaignCatalog(
  orgId: string,
  shopName: string,
  lookup: KbLookup,
  now: number = Date.now(),
): Promise<string | null> {
  const paths = await getCampaignCatalogs(orgId, shopName, lookup, now);
  return paths[0] ?? null;
}

/**
 * Warm cache catalog cho MỌI org có KB sản phẩm — gọi lúc backend boot (nền). Sau khi warm,
 * lúc chủ shop mở màn chiến dịch + bấm "đính kèm bảng báo giá" → ảnh hiện tức thì (không chờ ghép).
 */
export async function warmAllCatalogs(): Promise<void> {
  const { prisma } = await import('../../shared/database/prisma-client.js');
  const { generateEmbedding } = await import('../ai/knowledge/embedding.js');
  const { searchKnowledge } = await import('../ai/knowledge/knowledge-service.js');
  const { logger } = await import('../../shared/utils/logger.js');
  // các org có ít nhất 1 chunk sản phẩm
  const rows = await prisma.knowledgeChunk.findMany({
    where: { content: { contains: 'Tên sản phẩm:' } },
    select: { orgId: true },
    distinct: ['orgId'],
  });
  for (const { orgId } of rows) {
    try {
      const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
      const shopName = process.env.AI_SHOP_NAME || org?.name || 'Shop';
      const deps = { prisma, embed: generateEmbedding } as Parameters<typeof searchKnowledge>[0];
      const lookup = (q: string) => searchKnowledge(deps, orgId, q, 6, { provider: 'local', model: 'bge-m3', baseUrl: 'http://localhost:11434/v1' });
      const paths = await getCampaignCatalogs(orgId, shopName, lookup);
      logger.info('[catalog] warm org=%s → %d ảnh sẵn sàng', orgId.slice(0, 8), paths.length);
    } catch (e) {
      logger.warn('[catalog] warm org=%s lỗi: %s', orgId.slice(0, 8), (e as Error).message);
    }
  }
}
