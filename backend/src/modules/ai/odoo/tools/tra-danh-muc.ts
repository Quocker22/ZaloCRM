// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: liệt kê CÁC NHÓM HÀNG shop đang bán (kèm SP ví dụ có giá).
//
// VÌ SAO TOOL NÀY TỒN TẠI (bug thật 2026-07-30):
//   Khách mở lời "tôi muốn mua led về bán, bên bạn có những sản phẩm nào?" —
//   câu hỏi mở đầu phổ biến NHẤT của khách buôn. Bot lúc đó chỉ có `tra_san_pham`
//   (cần biết tên trước) nên buộc phải đoán từ khoá: tra "led" → 12 SP ziczac
//   trống giá, tra "nguồn 12v" → 3 SP, rồi bỏ cuộc chuyển sale.
//   Khách phản ứng đúng: "đến nói những sản phẩm mình bán thôi mà cũng không làm
//   được thì làm cái gì nữa".
//
//   Gốc rễ: KHÔNG có tool nào trả lời được câu "bán gì". Đó là lỗ hổng thiết kế,
//   không phải lỗi của model hay của dữ liệu.
//
// Chỉ đếm/nêu SP CÓ GIÁ THẬT — nhóm toàn hàng chưa nhập giá thì bot có nói ra
// cũng không báo giá được, kể tên chỉ làm khách hỏi rồi thất vọng.

import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';
import { NGUONG_GIA_AO } from './tra-san-pham.js';

/** Số SP ví dụ nêu trong mỗi nhóm. 2 là đủ để khách hình dung, không loãng. */
const VI_DU_MOI_NHOM = 2;

/** Số nhóm trả về tối đa — 21 nhóm đọc hết là quá dài cho tin nhắn Zalo. */
const NHOM_TOI_DA = 12;

/** Trần bản ghi quét. Catalog hiện ~1.950 SP; 3.000 là dư gấp rưỡi. */
const TRAN_QUET = 3000;

export interface NhomHang {
  ten: string;
  soSanPham: number;
  viDu: Array<{ ten: string; gia: number }>;
}

export interface TraDanhMucDeps {
  odoo: Pick<OdooClient, 'searchRead'>;
}

/** Odoo trả many2one dạng [id, "tên"]. Lấy phần tên. */
function tenM2O(v: unknown): string | null {
  return Array.isArray(v) && v.length >= 2 ? String(v[1]) : null;
}

/**
 * Liệt kê nhóm hàng đang bán.
 *
 * Gộp phía client thay vì `read_group` của Odoo: ta cần cả SP VÍ DỤ kèm giá
 * trong mỗi nhóm, mà `read_group` chỉ trả số đếm — vẫn phải query lần hai cho
 * từng nhóm (21 round-trip). Một lần quét rồi gộp trong JS rẻ hơn nhiều.
 */
export async function traDanhMuc(
  deps: TraDanhMucDeps,
  input: { tu_khoa?: string } = {},
): Promise<NhomHang[]> {
  const domain: unknown[] = [
    ['sale_ok', '=', true],
    ['active', '=', true],
    ['product_tmpl_id.active', '=', true],
    // Chỉ SP có giá thật — xem lý do ở đầu file.
    ['list_price', '>', NGUONG_GIA_AO],
  ];

  // Khách nói rõ mảng quan tâm ("ngoài trời", "nguồn") → thu hẹp trước khi gộp.
  const tuKhoa = input.tu_khoa?.trim();
  if (tuKhoa) domain.push(['name', 'ilike', tuKhoa]);

  const rows = await deps.odoo.searchRead<Record<string, unknown>>(
    'product.product',
    domain,
    ['name', 'categ_id', 'list_price'],
    // Sắp giá giảm dần: SP ví dụ trong mỗi nhóm là hàng đáng kể, không phải
    // phụ kiện lẻ vài nghìn — khách buôn quan tâm mặt hàng chính.
    { limit: TRAN_QUET, order: 'list_price desc' },
  );

  const theoNhom = new Map<string, NhomHang>();
  for (const r of rows) {
    const ten = tenM2O(r.categ_id) ?? 'Khác';
    let nhom = theoNhom.get(ten);
    if (!nhom) {
      nhom = { ten, soSanPham: 0, viDu: [] };
      theoNhom.set(ten, nhom);
    }
    nhom.soSanPham += 1;
    if (nhom.viDu.length < VI_DU_MOI_NHOM) {
      nhom.viDu.push({ ten: String(r.name ?? ''), gia: Number(r.list_price ?? 0) });
    }
  }

  return [...theoNhom.values()]
    .sort((a, b) => b.soSanPham - a.soSanPham)
    .slice(0, NHOM_TOI_DA);
}

export const traDanhMucDefinition: ToolDefinition = {
  name: 'tra_danh_muc',
  description:
    'Liệt kê các NHÓM HÀNG shop đang bán, kèm số lượng mặt hàng và sản phẩm ví dụ có giá. ' +
    'GỌI KHI khách hỏi chung chung: "bên bạn bán gì", "có sản phẩm nào", "tôi muốn nhập hàng ' +
    'về bán nhưng chưa biết loại nào", "gợi ý cho tôi đi". ' +
    'DÙNG TOOL NÀY THAY VÌ đoán từ khoá rồi gọi tra_san_pham nhiều lần. ' +
    'Sau khi có danh sách nhóm, hãy nêu vài nhóm chính cho khách rồi hỏi khách quan tâm nhóm nào.',
  inputSchema: {
    type: 'object',
    properties: {
      tu_khoa: {
        type: 'string',
        description:
          'Không bắt buộc. Chỉ truyền khi khách đã nói rõ mảng quan tâm, ' +
          'vd "ngoài trời", "nguồn". Bỏ trống để xem toàn bộ nhóm hàng.',
      },
    },
    required: [],
  },
};

/**
 * Định dạng cho LLM đọc.
 *
 * Nêu giá SP ví dụ để model có số thật mà nói ngay, khỏi phải gọi thêm
 * `tra_san_pham` một vòng nữa chỉ để lấy giá minh hoạ.
 */
export function dinhDangDanhMuc(list: NhomHang[]): string {
  if (list.length === 0) {
    return (
      'Không có nhóm hàng nào khớp. Nếu đã truyền tu_khoa thì gọi lại KHÔNG có tu_khoa ' +
      'để xem toàn bộ nhóm hàng.'
    );
  }

  const dong = list
    .map((n) => {
      const vd = n.viDu
        .map((s) => `${s.ten} ${s.gia.toLocaleString('vi-VN')}đ`)
        .join('; ');
      return `- ${n.ten} (${n.soSanPham} mặt hàng) — vd: ${vd}`;
    })
    .join('\n');

  return (
    `Shop đang bán ${list.length} nhóm hàng chính (chỉ tính hàng đã có giá):\n${dong}\n` +
    'HÃY nêu tên vài nhóm phù hợp cho khách bằng lời tự nhiên rồi hỏi khách quan tâm nhóm nào. ' +
    'ĐỪNG chuyển sale chỉ vì khách hỏi chung — thông tin trên đã đủ để tư vấn.'
  );
}
