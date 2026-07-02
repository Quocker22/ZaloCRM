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

/**
 * Với mỗi món khách chốt, tìm chunk KB khớp nhất (top-1 của search) và lấy giá.
 * search do caller cung cấp (tái dùng hybrid search sẵn có).
 */
export async function resolveOrder(order: OrderLine[], lookup: KbLookup): Promise<ResolvedOrder> {
  const items: ResolvedItem[] = [];
  for (const line of order) {
    const qty = Math.max(1, Math.floor(line.qty || 1));
    let unitPrice: number | null = null;
    let name = line.name;
    try {
      const hits = await lookup(line.name);
      // chunk khớp nhất CÓ giá; nếu top có tên thì dùng tên KB.
      for (const h of hits) {
        const p = parsePriceFromChunk(h.content);
        const n = nameFromChunk(h.content);
        if (n && unitPrice === null) name = n; // ưu tiên tên chunk đầu tiên
        if (p !== null) {
          unitPrice = p;
          if (n) name = n;
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
