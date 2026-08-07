// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: gửi ẢNH hóa đơn + link xử lý cho nhân viên.
//
// ⚠️ CHỈ ĐĂNG KÝ Ở REGISTRY NHÂN VIÊN.
// Report `report_saleorder_kiotviet` IN DƯ NỢ của khách (đo thật: 93.951.424đ
// trên đơn S13788). Gửi cho khách là lộ công nợ — đúng thứ mà registry khách cố
// ý chặn khi không có `tra_khach_hang`. Có test khẳng định điều này.
//
// Tool KHÔNG tự gửi tin Zalo: nó trả về ảnh + link, caller quyết định gửi đi
// đâu. Tách vậy để test được mà không cần Zalo thật, và để luồng playground
// (không có Zalo) vẫn dùng được.

import type { ToolDefinition } from '../../agent/types.js';
import type { OdooClient } from '../client.js';
import { HoaDonAnhClient, linkXuLyDon, type AnhHoaDon } from '../hoa-don-anh.js';
import { IDEMPOTENCY_PREFIX } from '../idempotency.js';

export interface KetQuaGuiHoaDon {
  donId: number;
  maDon: string;
  tongTien: number;
  tenKhach: string;
  /** Ảnh PNG — caller đính kèm vào tin Zalo. */
  anh: AnhHoaDon | null;
  /** Link backend cho nhân viên bấm vào xử lý. */
  link: string;
  /** Lý do không render được ảnh (link vẫn dùng được). */
  loiAnh?: string;
}

export interface GuiHoaDonDeps {
  odoo: Pick<OdooClient, 'searchRead'>;
  anhClient: HoaDonAnhClient;
  odooUrl: string;
  /**
   * id hội thoại Zalo — cho ca "xuất hoá đơn" nói TRỐNG (07/08): không mã,
   * không id thì lấy đơn MỚI NHẤT bot đã tạo trong hội thoại này (nhận diện
   * qua khoá idempotency `zalo:<conversationId>:*` trong client_order_ref).
   */
  conversationId?: string;
}

/** Tìm đơn theo id, mã (S13788), hoặc đơn mới nhất của hội thoại. Trả null nếu không có. */
async function timDon(
  deps: Pick<GuiHoaDonDeps, 'odoo' | 'conversationId'>,
  input: { don_id?: number; ma_don?: string },
): Promise<Record<string, unknown> | null> {
  const fields = ['id', 'name', 'amount_total', 'partner_id', 'state'];

  if (input.don_id) {
    const r = await deps.odoo.searchRead<Record<string, unknown>>(
      'sale.order', [['id', '=', input.don_id]], fields, { limit: 1 },
    );
    if (r.length > 0) return r[0];
  }

  const ma = input.ma_don?.trim();
  if (ma) {
    const r = await deps.odoo.searchRead<Record<string, unknown>>(
      'sale.order', [['name', '=', ma]], fields, { limit: 1 },
    );
    if (r.length > 0) return r[0];
  }

  // Nói trống "xuất hoá đơn" → đơn bot tạo GẦN NHẤT của chính hội thoại này.
  // Chỉ đơn có khoá idempotency của hội thoại — không bao giờ lấy nhầm đơn
  // của khách khác hay đơn sale lên tay.
  if (!input.don_id && !ma && deps.conversationId?.trim()) {
    const r = await deps.odoo.searchRead<Record<string, unknown>>(
      'sale.order',
      [['client_order_ref', 'like', `${IDEMPOTENCY_PREFIX}:${deps.conversationId.trim()}:%`]],
      fields,
      { limit: 1, order: 'create_date desc' },
    );
    if (r.length > 0) return r[0];
  }
  return null;
}

export async function guiHoaDon(
  deps: GuiHoaDonDeps,
  input: { don_id?: number; ma_don?: string },
): Promise<KetQuaGuiHoaDon | null> {
  const don = await timDon(deps, input);
  if (!don) return null;

  const donId = Number(don.id);
  const maDon = String(don.name ?? '');
  const link = linkXuLyDon(deps.odooUrl, donId);

  // Render ảnh KHÔNG được làm hỏng cả tool: Odoo render qweb có thể chậm hoặc
  // lỗi font. Thà gửi link không có ảnh còn hơn không gửi gì.
  let anh: AnhHoaDon | null = null;
  let loiAnh: string | undefined;
  try {
    anh = await deps.anhClient.render(donId, maDon);
  } catch (err) {
    loiAnh = err instanceof Error ? err.message : String(err);
  }

  return {
    donId,
    maDon,
    tongTien: Number(don.amount_total ?? 0),
    tenKhach: Array.isArray(don.partner_id) ? String(don.partner_id[1]) : '',
    anh,
    link,
    loiAnh,
  };
}

export const guiHoaDonDefinition: ToolDefinition = {
  name: 'gui_hoa_don',
  description:
    'Lấy ẢNH hóa đơn/báo giá của một đơn kèm link để nhân viên bấm vào xử lý — ' +
    'KHÔNG ghi gì vào Odoo. GỌI KHI nhân viên nói: "gửi hóa đơn", "gửi hình đơn", ' +
    '"cho xem báo giá", "gửi lại hóa đơn đơn S13788". ' +
    'Nhân viên nói "XUẤT hóa đơn" (hoá đơn kế toán) → dùng xuat_hoa_don, KHÔNG phải tool này. ' +
    'SAU KHI TẠO ĐƠN bằng tao_don_nhap thì GỌI LUÔN tool này — nhân viên cần thấy ' +
    'hóa đơn ngay, không phải hỏi thêm. ' +
    'Truyền don_id (nhanh hơn) hoặc ma_don. Nhân viên xin gửi ảnh mà KHÔNG kèm mã ' +
    '→ gọi KHÔNG THAM SỐ, tool tự lấy đơn mới nhất của hội thoại.',
  inputSchema: {
    type: 'object',
    properties: {
      don_id: {
        type: 'integer',
        description: 'id đơn hàng, lấy từ kết quả tao_don_nhap. Ưu tiên dùng cái này.',
      },
      ma_don: {
        type: 'string',
        description: 'Mã đơn dạng S13788. Dùng khi nhân viên nói mã mà không có id.',
      },
    },
    required: [],
  },
};

/** VND không thập phân. */
function tien(n: number): string {
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}

/**
 * Định dạng cho LLM.
 *
 * Nói rõ ảnh ĐÃ được đính kèm để model không mô tả lại nội dung hóa đơn — nó
 * không nhìn thấy ảnh, mô tả là bịa.
 */
export function dinhDangGuiHoaDon(kq: KetQuaGuiHoaDon | null): string {
  if (!kq) {
    return (
      'Không tìm thấy đơn. Kiểm tra lại id hoặc mã đơn (dạng S13788). ' +
      'Nếu vừa tạo đơn thì lấy id từ kết quả tao_don_nhap.'
    );
  }

  const dong = [
    `Đơn ${kq.maDon}${kq.tenKhach ? ` · ${kq.tenKhach}` : ''} · ${tien(kq.tongTien)}`,
    `Link xử lý: ${kq.link}`,
  ];

  if (kq.anh) {
    // Model KHÔNG nhìn thấy ảnh — cấm nó tả nội dung, kẻo bịa số.
    dong.push(
      'Ảnh hóa đơn ĐÃ được đính kèm tự động vào tin nhắn. ' +
      'Chỉ cần báo ngắn là đã gửi kèm hóa đơn và đưa link — ' +
      'ĐỪNG mô tả lại nội dung trong ảnh (bạn không nhìn thấy nó).',
    );
  } else {
    dong.push(
      `Không tạo được ảnh hóa đơn (${kq.loiAnh ?? 'lỗi không rõ'}). ` +
      'Vẫn đưa link cho nhân viên mở trực tiếp.',
    );
  }

  return dong.join('\n');
}
