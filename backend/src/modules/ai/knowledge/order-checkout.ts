// SPDX-License-Identifier: AGPL-3.0-or-later
// Chốt đơn: từ danh sách {name, qty} bot trích được, tra giá KB cho từng món rồi
// tính tổng BẰNG CODE (không nhờ LLM — giữ nguyên tắc chống bịa số). Thiếu giá bất
// kỳ món → missingPrice=true (caller sẽ báo sale, không gen QR).

export interface OrderLine {
  name: string;
  qty: number;
}
export interface ResolvedItem {
  name: string; // tên khớp trong KB (hoặc tên khách nói nếu không tra được)
  qty: number;
  unitPrice: number | null; // null = chưa có giá trong KB
}
export interface ResolvedOrder {
  items: ResolvedItem[];
  total: number; // tổng các món CÓ giá (qty×unitPrice)
  missingPrice: boolean; // true nếu có ≥1 món không tra được giá
}

/** Tra giá từ 1 chunk KB: "Giá bán: 4.800đ" → 4800; "chưa có trong dữ liệu" → null. */
export function parsePriceFromChunk(content: string): number | null {
  const m = content.match(/Giá bán:\s*([\d.]+)\s*đ/i);
  if (!m) return null;
  const digits = m[1].replace(/\./g, '');
  const n = Number(digits);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Lấy tên SP từ chunk (để hiển thị đúng tên KB). */
function nameFromChunk(content: string): string | null {
  const m = content.match(/Tên sản phẩm:\s*([^\n]+)/i);
  return m ? m[1].trim() : null;
}

export type KbLookup = (query: string) => Promise<Array<{ content: string }>>;

/** Token hoá tên SP (bỏ dấu, tách từ ≥2 ký tự) để so khớp tên query vs chunk. */
function nameTokens(s: string): Set<string> {
  const noAccent = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return new Set(
    noAccent
      .replace(/\([^)]*\)/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((t) => t.length >= 2),
  );
}

/** Model-code trong tên: token có số + ≥3 ký tự, không phải đơn vị đơn (12v/5a/1m). Vd P10, 2835, 12V400W. */
function modelCodes(tokens: Set<string>): Set<string> {
  return new Set(
    [...tokens].filter((t) => t.length >= 3 && /\d/.test(t) && !/^\d+[mvaw]$/.test(t)),
  );
}

/**
 * Với mỗi món khách chốt, tìm chunk KB đúng SP + có giá. Khớp theo 2 cửa:
 *  (a) MODEL-CODE: nếu query có mã (P10, 2835...) thì chunk phải chứa ÍT NHẤT 1 mã đó
 *      (chống nhầm P10→P4, 5054→5730) — token thường ("indoor" vs "in") không cần trùng.
 *  (b) Không có mã → yêu cầu ≥60% token tên query khớp (chống gán nhầm SP tên khác hẳn).
 * search do caller cung cấp (tái dùng hybrid search sẵn có).
 */
export async function resolveOrder(order: OrderLine[], lookup: KbLookup): Promise<ResolvedOrder> {
  const items: ResolvedItem[] = [];
  for (const line of order) {
    const qty = Math.max(1, Math.floor(line.qty || 1));
    let unitPrice: number | null = null;
    let name = line.name;
    const qTokens = nameTokens(line.name);
    const qCodes = modelCodes(qTokens);
    try {
      const hits = await lookup(line.name);
      for (const h of hits) {
        const n = nameFromChunk(h.content);
        if (!n) continue;
        const nTokens = nameTokens(n);
        let matched: boolean;
        if (qCodes.size > 0) {
          // có model-code → chunk phải chứa ≥1 code khớp (không bắt token thường).
          const nCodes = modelCodes(nTokens);
          matched = [...qCodes].some((c) => nCodes.has(c));
        } else {
          // không có code → dựa token overlap ≥60%.
          const overlap = [...qTokens].filter((t) => nTokens.has(t)).length;
          matched = qTokens.size ? overlap / qTokens.size >= 0.6 : false;
        }
        if (!matched) continue;
        const p = parsePriceFromChunk(h.content);
        if (unitPrice === null) name = n; // tên KB của SP khớp đầu tiên
        if (p !== null) {
          unitPrice = p;
          name = n;
          break;
        }
      }
    } catch {
      unitPrice = null;
    }
    items.push({ name, qty, unitPrice });
  }
  const missingPrice = items.some((it) => it.unitPrice === null);
  // Tổng tính bằng CODE, chỉ cộng món có giá.
  const total = items.reduce((s, it) => s + (it.unitPrice ?? 0) * it.qty, 0);
  return { items, total, missingPrice };
}

/** Định dạng tiền VN: 425000 → "425.000đ". */
export function formatVnd(n: number): string {
  return n.toLocaleString('vi-VN') + 'đ';
}

/** Dòng đơn cho tin nhắn (khách xác nhận / báo sale). */
export function formatOrderLines(o: ResolvedOrder): string {
  const lines = o.items.map((it) => {
    if (it.unitPrice === null) return `- ${it.name} x${it.qty}: (chưa có giá)`;
    return `- ${it.name} x${it.qty}: ${formatVnd(it.unitPrice)} = ${formatVnd(it.unitPrice * it.qty)}`;
  });
  if (!o.missingPrice) lines.push(`TỔNG: ${formatVnd(o.total)}`);
  return lines.join('\n');
}
