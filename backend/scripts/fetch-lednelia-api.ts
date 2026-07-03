// SPDX-License-Identifier: AGPL-3.0-or-later
// Lấy TẤT CẢ sản phẩm từ WooCommerce Store API của lednelia.com (public, không cần key).
// WAF rate-limit theo tần suất → delay giữa các trang + per_page nhỏ + retry. Lưu _specs.jsonl.
//   node --import tsx scripts/fetch-lednelia-api.ts
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://lednelia.com/wp-json/wc/store/v1/products';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PER_PAGE = 10;
const DELAY_MS = 5000;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../product-specs/_specs.jsonl');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stripHtml(s: string): string {
  return (s || '')
    .replace(/<\/(p|div|li|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;/g, '–').replace(/&hellip;/g, '…')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

interface WooProduct {
  name: string;
  slug: string;
  sku?: string;
  short_description?: string;
  description?: string;
  prices?: { price?: string; currency_minor_unit?: number };
}

async function fetchPage(page: number, tries = 3): Promise<WooProduct[] | null> {
  for (let t = 0; t < tries; t++) {
    try {
      const res = await fetch(`${BASE}?per_page=${PER_PAGE}&page=${page}`, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      if (res.status === 200) return (await res.json()) as WooProduct[];
      if (res.status === 400) return []; // hết trang
      // 403/429 → rate limit, đợi lâu hơn rồi thử lại
      await sleep(DELAY_MS * (t + 2));
    } catch {
      await sleep(DELAY_MS);
    }
  }
  return null;
}

async function main() {
  const specs: Array<{ ten: string; slug: string; gia: number | null; mota: string }> = [];
  let page = 1;
  while (page <= 30) {
    const products = await fetchPage(page);
    if (products === null) { console.log(`  ⚠ page ${page} fail sau retry, bỏ qua`); page++; await sleep(DELAY_MS); continue; }
    if (products.length === 0) { console.log(`  page ${page} rỗng → hết SP`); break; }
    for (const p of products) {
      const desc = [stripHtml(p.short_description ?? ''), stripHtml(p.description ?? '')].filter(Boolean).join('\n');
      const priceMinor = p.prices?.price ? Number(p.prices.price) : null;
      const unit = p.prices?.currency_minor_unit ?? 0;
      const gia = priceMinor !== null && priceMinor > 0 ? Math.round(priceMinor / Math.pow(10, unit)) : null;
      specs.push({ ten: p.name, slug: p.slug, gia, mota: desc });
    }
    console.log(`  page ${page}: +${products.length} SP (tổng ${specs.length})`);
    page++;
    await sleep(DELAY_MS);
  }
  writeFileSync(OUT, specs.map((s) => JSON.stringify(s)).join('\n') + '\n');
  const withDesc = specs.filter((s) => s.mota.length > 50).length;
  console.log(`\n===== ${specs.length} SP → ${OUT} | ${withDesc} SP có mô tả chi tiết =====`);
}
main().catch((e) => { console.error(e); process.exit(1); });
