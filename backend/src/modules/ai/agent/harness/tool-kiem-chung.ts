// SPDX-License-Identifier: AGPL-3.0-or-later
// BỘ TOOL CHỈ ĐỌC cho vòng kiểm chứng — dùng lại đúng các tool đọc Odoo của
// luồng nhân viên (tra khách, tra SP, đọc bảng) + xem lịch sử dài hơn. Không
// có tool nào ghi: con giám sát/điều phối chỉ được NHÌN, không được LÀM.
import type { OdooClient } from '../../odoo/client.js';
import { traKhachHang, traKhachHangDefinition, dinhDangKhachHang } from '../../odoo/tools/tra-khach-hang.js';
import { traSanPham, traSanPhamDefinition, dinhDangSanPham } from '../../odoo/tools/tra-san-pham.js';
import { docOdoo, docOdooDefinition, dinhDangDoc } from '../../odoo/tong-quat/doc.js';
import type { ToolKiemChung } from './vong-kiem-chung.js';

export interface DepsKiemChung {
  odoo?: Pick<OdooClient, 'searchRead' | 'execute'>;
  /** Lịch sử ĐẦY ĐỦ (cũ → mới) — prompt chỉ đưa vài lượt, model cần thêm thì xem. */
  lichSuDay?: Array<{ vai: string; noiDung: string }>;
}

export function boToolKiemChung(deps: DepsKiemChung): ToolKiemChung[] {
  const ra: ToolKiemChung[] = [];
  if (deps.odoo) {
    const odoo = deps.odoo;
    ra.push(
      {
        definition: { ...traKhachHangDefinition, description: `[CHỈ ĐỌC — kiểm chứng] ${traKhachHangDefinition.description}` },
        run: async (input) => dinhDangKhachHang(await traKhachHang({ odoo }, input as { sdt?: string; ten?: string; ma?: string })),
      },
      {
        definition: { ...traSanPhamDefinition, description: `[CHỈ ĐỌC — kiểm chứng] ${traSanPhamDefinition.description}` },
        run: async (input) => {
          const i = input as { ten: string; gioi_han?: number };
          return dinhDangSanPham(await traSanPham({ odoo }, i), i.ten);
        },
      },
      {
        definition: {
          ...docOdooDefinition,
          description:
            '[CHỈ ĐỌC — kiểm chứng] Đọc bảng Odoo để KIỂM: đơn S… thuộc khách nào (sale.order: name, partner_id, ' +
            'state, amount_total), hoá đơn INV/… (account.move), tồn kho. Dùng khi bản nháp/tin nêu mã đơn, ' +
            'số hoá đơn, tổng tiền mà cần đối chiếu. ' + docOdooDefinition.description,
        },
        run: async (input) => dinhDangDoc(await docOdoo({ odoo }, input as never)),
      },
    );
  }
  if (deps.lichSuDay && deps.lichSuDay.length > 0) {
    const ls = deps.lichSuDay;
    ra.push({
      definition: {
        name: 'xem_lich_su',
        description: 'Xem thêm lịch sử hội thoại cũ hơn phần đã cho (cũ → mới). Dùng khi cần biết người ta đã nói/chốt gì trước đó.',
        inputSchema: {
          type: 'object',
          properties: { so_luot: { type: 'integer', description: 'Số lượt gần nhất muốn xem (tối đa 40).' } },
          required: [],
        },
      },
      run: async (input) => {
        const n = Math.min(40, Math.max(1, Number((input as { so_luot?: number }).so_luot) || 20));
        return ls.slice(-n).map((m) => `[${m.vai}] ${m.noiDung.slice(0, 300)}`).join('\n');
      },
    });
  }
  return ra;
}
