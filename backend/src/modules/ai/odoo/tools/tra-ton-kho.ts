// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: tra tồn kho theo sản phẩm, tách theo từng kho.
//
// Đây là dữ liệu KB KHÔNG BAO GIỜ có. Trước đây bot chỉ trả lời được chung chung
// ("có sẵn giao ngay") mà không biết còn thật hay không. Tool này nối vào số thật.
//
// Lưu ý về nguồn số: ARCHITECTURE.md của lednelia ghi rõ "Đừng tin số stored cho
// tiền/kho/giao hàng — tính lại từ nguồn gốc", và chính test của họ đối chiếu với
// SUM(stock_quant). Ở đây ta đọc qua ORM (qty_available có context kho) vì đó là
// đường duy nhất qua XML-RPC — nhưng E2E test PHẢI đối chiếu lại bằng SQL.

import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';

export interface TonKho {
  khoId: number;
  tenKho: string;
  tonThucTe: number;   // on_hand — số đang nằm trong kho
  daGiuCho: number;    // reserved — đã hứa cho đơn khác
  conBanDuoc: number;  // free = on_hand - reserved  ← số dùng để trả lời khách
}

export interface KetQuaTonKho {
  sanPhamId: number;
  tenSanPham: string;
  theoKho: TonKho[];
  tongConBanDuoc: number;
}

export interface TraTonKhoDeps {
  odoo: Pick<OdooClient, 'execute' | 'searchRead'>;
}

/**
 * Tra tồn kho một SP trên tất cả kho.
 *
 * Dùng `incokit_stock_breakdown` — field computed của module incokit_pos, trả
 * cả 3 kho + số đã giữ chỗ trong MỘT lần gọi. Rẻ hơn nhiều so với lặp
 * qty_available theo từng kho (mỗi kho một round-trip XML-RPC).
 */
export async function traTonKho(
  deps: TraTonKhoDeps,
  input: { san_pham_id: number },
): Promise<KetQuaTonKho | null> {
  const id = Number(input.san_pham_id);
  if (!Number.isInteger(id) || id <= 0) return null;

  const rows = await deps.odoo.searchRead<Record<string, unknown>>(
    'product.product',
    [['id', '=', id]],
    ['id', 'name', 'incokit_stock_breakdown'],
    { limit: 1 },
  );
  if (rows.length === 0) return null;

  const row = rows[0];
  const raw = row.incokit_stock_breakdown;

  // Field là Json — Odoo có thể trả về string hoặc đã parse sẵn.
  let breakdown: unknown;
  try {
    breakdown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    breakdown = null;
  }

  const theoKho: TonKho[] = Array.isArray(breakdown)
    ? breakdown
        // Bỏ dòng "Tổng" mà module tự thêm vào — ta tự cộng để chắc chắn.
        .filter((b) => b && typeof b === 'object' && !(b as Record<string, unknown>).is_total)
        .map((b) => {
          const o = b as Record<string, unknown>;
          const onHand = Number(o.on_hand ?? 0);
          const reserved = Number(o.reserved ?? 0);
          return {
            khoId: Number(o.warehouse_id ?? 0),
            tenKho: String(o.name ?? 'Không rõ'),
            tonThucTe: onHand,
            daGiuCho: reserved,
            // Tự tính thay vì tin field `free` — cùng nguyên tắc "tính lại từ
            // nguồn gốc" mà lednelia dùng cho tiền/kho.
            conBanDuoc: onHand - reserved,
          };
        })
    : [];

  return {
    sanPhamId: id,
    tenSanPham: String(row.name ?? ''),
    theoKho,
    tongConBanDuoc: theoKho.reduce((s, k) => s + k.conBanDuoc, 0),
  };
}

export const traTonKhoDefinition: ToolDefinition = {
  name: 'tra_ton_kho',
  description:
    'Tra số lượng còn trong kho của một sản phẩm, tách theo từng kho. Cần id sản phẩm ' +
    '(lấy từ tra_san_pham trước). GỌI KHI: khách hỏi còn hàng không, hỏi số lượng có sẵn, ' +
    'hoặc trước khi chốt đơn số lượng lớn. Số "còn bán được" đã trừ phần giữ chỗ cho đơn khác — ' +
    'dùng số này để trả lời khách, KHÔNG dùng tồn thực tế. ' +
    // Model hay gọi tuần tự từng SP một khi tra nhiều SP → tốn 3-4 vòng lặp.
    'Cần tra NHIỀU sản phẩm thì gọi tool này NHIỀU LẦN TRONG CÙNG MỘT LƯỢT (song song), ' +
    'đừng gọi lần lượt từng vòng.',
  inputSchema: {
    type: 'object',
    properties: {
      san_pham_id: { type: 'integer', description: 'id sản phẩm, lấy từ kết quả tra_san_pham' },
    },
    required: ['san_pham_id'],
  },
};

/** Định dạng cho LLM. Nói rõ "còn bán được" để model không nhầm với tồn thực tế. */
export function dinhDangTonKho(kq: KetQuaTonKho | null): string {
  if (!kq) return 'Không tìm thấy sản phẩm với id đó. Hãy tra_san_pham lại để lấy id đúng.';
  if (kq.theoKho.length === 0) {
    return `${kq.tenSanPham}: chưa có dữ liệu tồn kho. Nên chuyển sale kiểm tra thủ công.`;
  }
  // Chỉ liệt kê kho CÓ HÀNG. Kho trống là nhiễu — chiếm chỗ trong lịch sử hội
  // thoại (bị tính tiền lại mỗi vòng) mà không giúp nhân viên quyết định gì.
  const coHang = kq.theoKho.filter((k) => k.tonThucTe > 0 || k.daGiuCho > 0);
  const khoTrong = kq.theoKho.length - coHang.length;

  if (coHang.length === 0) {
    return `${kq.tenSanPham}: HẾT HÀNG ở tất cả ${kq.theoKho.length} kho.`;
  }

  const dong = coHang
    .map((k) => `- ${k.tenKho}: còn bán được ${k.conBanDuoc} (tồn ${k.tonThucTe}, giữ chỗ ${k.daGiuCho})`)
    .join('\n');
  const ghiChu = khoTrong > 0 ? ` (${khoTrong} kho khác hết hàng)` : '';
  return `${kq.tenSanPham}\n${dong}\nTỔNG CÒN BÁN ĐƯỢC: ${kq.tongConBanDuoc}${ghiChu}`;
}
