// SPDX-License-Identifier: AGPL-3.0-or-later
// Ảnh sản phẩm theo URL — nguồn là cột "Link ảnh" của Google Sheet thông số,
// đồng bộ vào bảng anh_san_pham bằng scripts/dong-bo-sheet.mjs.
//
// Khác kho crawl cứng (product-image.ts): công ty dán link vào sheet là bot có
// ảnh mới — không cần deploy. Bộ LUẬT AN TOÀN gửi ảnh chủ động thì kế thừa
// nguyên xi từ product-image (mỗi luật là một bug thật đã trả giá):
//   - câu liệt kê (>=3 gạch đầu dòng) → im
//   - SP có model-code → reply phải chứa code (chống nhầm biến thể 100W/200W)
//   - nhiều SP cùng khớp → im, thà không gửi còn hơn gửi nhầm
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { logger } from '../../../shared/utils/logger.js';

/** Client tối thiểu — nhận PrismaClient thật lẫn bản giả trong test. */
export interface DbAnhSanPham {
  anhSanPham: {
    findMany(a: { where: { orgId: string } }): Promise<Array<{ ten: string; urls: unknown }>>;
  };
}

/** Tối đa số ảnh gửi cho một câu trả lời — dội bom 5 tấm là spam khách. */
const TOI_DA_ANH = 3;

/** Cache danh sách theo org — bảng nhỏ (vài trăm dòng), đọc lại mỗi 5 phút. */
const TTL_MS = 5 * 60_000;
let cache: { orgId: string; luc: number; ds: Array<{ tokens: string[]; urls: string[] }> } | null = null;

export function resetCacheAnhSp(): void {
  cache = null;
}

function normTokens(s: string): string[] {
  const khongDau = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return khongDau
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2);
}

function codeTokens(tokens: string[]): Set<string> {
  return new Set(tokens.filter((t) => t.length >= 3 && /\d/.test(t) && !/^\d+[mvaw]$/.test(t)));
}

async function loadDs(db: DbAnhSanPham, orgId: string) {
  if (cache && cache.orgId === orgId && Date.now() - cache.luc < TTL_MS) return cache.ds;
  const rows = await db.anhSanPham.findMany({ where: { orgId } });
  const ds = rows.map((r) => ({
    tokens: normTokens(r.ten),
    urls: (Array.isArray(r.urls) ? r.urls : []).map(String).filter((u) => u.startsWith('http')),
  }));
  cache = { orgId, luc: Date.now(), ds };
  return ds;
}

/**
 * Tìm URLs ảnh của sản phẩm được nhắc trong câu trả lời. Trả [] khi không
 * chắc chắn — cùng triết lý findImageForReply.
 */
export async function timAnhSanPhamTheoReply(
  db: DbAnhSanPham,
  orgId: string,
  replyText: string,
): Promise<string[]> {
  const ds = await loadDs(db, orgId);
  if (ds.length === 0) return [];

  const soGachDau = (replyText.match(/^\s*[-•*\d]+[.)]?\s+/gm) ?? []).length;
  if (soGachDau >= 3) return [];

  const rTokens = new Set(normTokens(replyText));
  if (rTokens.size === 0) return [];

  let best: { urls: string[]; score: number } | null = null;
  let soKhop = 0;
  for (const p of ds) {
    if (p.tokens.length < 3 || p.urls.length === 0) continue;
    const codes = codeTokens(p.tokens);
    if (codes.size > 0 && ![...codes].some((c) => rTokens.has(c))) continue;
    const inter = p.tokens.filter((t) => rTokens.has(t)).length;
    const score = inter / p.tokens.length;
    if (score >= 0.6) {
      soKhop++;
      if (!best || score > best.score) best = { urls: p.urls, score };
    }
  }
  if (soKhop > 3 || !best) return [];
  return best.urls.slice(0, TOI_DA_ANH);
}

/** Thư mục cache ảnh tải về. Volume files là mount bền; thiếu thì rơi về tmp. */
const CACHE_DIR = existsSync('/var/lib/zalo-crm/files')
  ? '/var/lib/zalo-crm/files/anh-sp'
  : join(tmpdir(), 'zcrm-anh-sp');

/** Đường dẫn cache cho một URL — hash để tên file ổn định, giữ đuôi ảnh. */
export function duongDanCacheAnh(url: string): string {
  const hash = createHash('sha1').update(url).digest('hex').slice(0, 16);
  const duoi = (extname(new URL(url).pathname) || '.jpg').toLowerCase();
  return join(CACHE_DIR, `${hash}${duoi}`);
}

/**
 * Tải ảnh về file cục bộ (gửi Zalo cần đường dẫn file). Có cache — cùng URL
 * chỉ tải một lần. Lỗi thì ném — caller quyết nuốt (gửi ảnh là phụ, không
 * được phá câu trả lời).
 */
export async function taiAnhVeTam(url: string): Promise<string> {
  const duong = duongDanCacheAnh(url);
  if (existsSync(duong)) return duong;
  mkdirSync(CACHE_DIR, { recursive: true });
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`tải ảnh ${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1000) throw new Error(`ảnh ${url} quá nhỏ (${buf.length}B) — nghi lỗi`);
  writeFileSync(duong, buf);
  logger.info({ url, duong, kb: Math.round(buf.length / 1024) }, '[anh-sp] đã tải ảnh về cache');
  return duong;
}
