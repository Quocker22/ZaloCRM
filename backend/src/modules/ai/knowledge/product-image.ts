// SPDX-License-Identifier: AGPL-3.0-or-later
// Kho ảnh sản phẩm (crawl từ web) + tra ảnh theo câu trả lời của bot.
// Map product-images/_kb_match.json: { tên SP trong KB: { web, file, score } }.
// Ảnh nằm ở product-images/<file>. Chỉ gửi khi câu reply nhắc ĐÚNG 1 sản phẩm có ảnh.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const IMG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../product-images');
const MATCH_FILE = join(IMG_DIR, '_kb_match.json');

interface Match {
  web: string;
  file: string;
  score: number;
}

let cache: Array<{ name: string; tokens: string[]; file: string }> | null = null;

function normTokens(s: string): string[] {
  const noAccent = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return noAccent
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 2);
}

/** Load + cache map. Trả [] nếu chưa có file (tính năng ảnh chưa bật). */
function loadMap(): Array<{ name: string; tokens: string[]; file: string }> {
  if (cache) return cache;
  if (!existsSync(MATCH_FILE)) {
    cache = [];
    return cache;
  }
  try {
    const raw = JSON.parse(readFileSync(MATCH_FILE, 'utf8')) as Record<string, Match>;
    cache = Object.entries(raw).map(([name, m]) => ({ name, tokens: normTokens(name), file: m.file }));
  } catch {
    cache = [];
  }
  return cache;
}

// Token định danh (chứa số, >=3 ký tự, không phải đơn vị 12v/5a) — model code.
function codeTokens(tokens: string[]): Set<string> {
  return new Set(tokens.filter((t) => t.length >= 3 && /\d/.test(t) && !/^\d+[mvaw]$/.test(t)));
}

/**
 * Tìm ảnh sản phẩm khớp câu trả lời. Trả về đường dẫn ảnh cục bộ, hoặc null.
 * Nguyên tắc AN TOÀN cho gửi ẢNH CHỦ ĐỘNG: chỉ trả 1 ảnh khi câu reply chứa gần đủ
 * token tên 1 sản phẩm (>=0.6 overlap) VÀ nếu SP có model-code thì code phải xuất hiện trong reply.
 * Không chắc → null (thà không gửi còn hơn gửi nhầm).
 */
export function findImageForReply(replyText: string): string | null {
  const map = loadMap();
  if (map.length === 0) return null;

  // CÂU LIỆT KÊ DANH MỤC → KHÔNG gửi ảnh.
  //
  // Bug thật 2026-08-05: khách hỏi "nhà có led gì nhỉ", bot liệt kê 7 nhóm hàng
  // rồi gửi kèm ảnh "Module 3 LED 220V" — chẳng liên quan gì. Câu liệt kê chứa
  // nhiều từ chung ("led", "dây", "bóng") nên trùng ≥60% với tên một SP ngắn.
  //
  // Dấu hiệu: nhiều dòng gạch đầu dòng, hoặc nhắc nhiều nhóm hàng cùng lúc.
  const soGachDau = (replyText.match(/^\s*[-•*\d]+[.)]?\s+/gm) ?? []).length;
  if (soGachDau >= 3) return null;

  const rTokens = new Set(normTokens(replyText));
  if (rTokens.size === 0) return null;

  let best: { file: string; score: number } | null = null;
  let soKhop = 0;
  for (const p of map) {
    if (p.tokens.length === 0) continue;
    // Tên SP quá ngắn (1-2 token) thì 60% chỉ cần trùng 1-2 từ chung — quá dễ
    // khớp nhầm. Đòi tên đủ đặc trưng mới cho gửi ảnh.
    if (p.tokens.length < 3) continue;
    const codes = codeTokens(p.tokens);
    // Nếu SP có model-code, reply PHẢI chứa ít nhất 1 code đó (chống nhầm biến thể).
    if (codes.size > 0 && ![...codes].some((c) => rTokens.has(c))) continue;
    const inter = p.tokens.filter((t) => rTokens.has(t)).length;
    const score = inter / p.tokens.length; // bao nhiêu % token TÊN SP xuất hiện trong reply
    if (score >= 0.6) {
      soKhop++;
      if (!best || score > best.score) best = { file: p.file, score };
    }
  }
  // NHIỀU SP cùng khớp → không biết khách hỏi cái nào. Thà im còn hơn đoán.
  if (soKhop > 3) return null;
  if (!best) return null;
  const path = join(IMG_DIR, best.file);
  return existsSync(path) ? path : null;
}
