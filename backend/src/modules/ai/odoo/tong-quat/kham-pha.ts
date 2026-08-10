// SPDX-License-Identifier: AGPL-3.0-or-later
// kham_pha_odoo — bot tự hỏi Odoo về CẤU TRÚC của chính nó: bảng nào có cột gì,
// bấm được nút nào, tên bảng cho nghiệp vụ này là gì.
//
// Đây là mảnh làm cho câu "thao tác gì trên Odoo cũng làm được" thành sự thật:
// việc lạ chưa ai khai trong bảng thao_tac_odoo thì bot tự tra cấu trúc rồi
// dựng lệnh, thay vì đợi người viết thêm tool.
import type { ToolDefinition } from '../../agent/types.js';
import type { OdooClient } from '../client.js';
import { laCotCam } from './an-toan.js';

export interface KhamPhaDeps {
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
}

export interface KhamPhaInput {
  bang?: string;
  hoi: 'cot' | 'nut' | 'tim_bang';
  tu_khoa?: string;
}

export type KetQuaKhamPha =
  | { trangThai: 'ok'; hoi: KhamPhaInput['hoi']; dong: string[] }
  | { trangThai: 'loi'; lyDo: string };

/**
 * Method hay dùng nhất trên các model bán hàng/kho/kế toán của Odoo.
 *
 * Cố ý KHÔNG liệt kê hết: Odoo có hàng trăm method, và `ir.model.fields` không
 * chứa danh sách method nên không tra tự động được. Bot cứ thử tên hợp lý —
 * sai thì Odoo báo lỗi rõ, không hỏng gì.
 */
const NUT_THUONG_DUNG: Array<[string, string]> = [
  ['action_confirm', 'xác nhận đơn bán (nháp → đã bán)'],
  ['action_cancel', 'huỷ đơn'],
  ['action_draft', 'đưa về nháp'],
  ['action_post', 'vào sổ hoá đơn/bút toán kế toán'],
  ['button_validate', 'xác nhận phiếu kho (nhập/xuất)'],
  ['action_quotation_send', 'gửi báo giá'],
  ['unlink', 'XOÁ — luôn phải xin nhân viên xác nhận trước'],
];

export async function khamPhaOdoo(
  deps: KhamPhaDeps,
  input: KhamPhaInput,
): Promise<KetQuaKhamPha> {
  try {
    if (input.hoi === 'tim_bang') {
      const tu = (input.tu_khoa ?? '').trim();
      if (!tu) return { trangThai: 'loi', lyDo: 'Tìm bảng thì phải có từ khoá.' };
      const rows = await deps.odoo.searchRead<{ model: string; name: string }>(
        'ir.model',
        ['|', ['name', 'ilike', tu], ['model', 'ilike', tu]],
        ['model', 'name'],
        { limit: 20 },
      );
      return { trangThai: 'ok', hoi: 'tim_bang', dong: rows.map((r) => `${r.model} — ${r.name}`) };
    }

    const bang = (input.bang ?? '').trim();
    if (!bang) return { trangThai: 'loi', lyDo: 'Hỏi cột/nút thì phải nêu tên bảng.' };

    if (input.hoi === 'nut') {
      return {
        trangThai: 'ok',
        hoi: 'nut',
        dong: NUT_THUONG_DUNG.map(([n, m]) => `${n} — ${m}`),
      };
    }

    // hoi === 'cot' — DÙNG fields_get, KHÔNG đọc ir.model.fields.
    //
    // Bug thật 19:01 10/08: user bot_zalo không có quyền đọc ir.model.fields
    // ("Liên hệ với quản trị viên của bạn") nên tool khám phá vô dụng — bot mù,
    // mò 10 lần rồi hết hạn 90s. fields_get là method trên chính model nên
    // quyền bán hàng thường là đủ (đo thật: sale.order.line trả 80 cột).
    const f = await deps.odoo.execute<Record<string, { string?: string; type?: string }>>(
      bang, 'fields_get', [], { attributes: ['string', 'type'] },
    );
    const dong = Object.entries(f ?? {})
      // Cột giá vốn/biên lợi nhuận không được LỘ RA ngay từ khâu khám phá —
      // model không biết nó tồn tại thì không xin đọc.
      .filter(([ten]) => !laCotCam(ten))
      .map(([ten, mo]) => `${ten} (${mo?.type ?? '?'}) — ${mo?.string ?? ''}`)
      .sort();
    return { trangThai: 'ok', hoi: 'cot', dong };
  } catch (err) {
    return { trangThai: 'loi', lyDo: err instanceof Error ? err.message : String(err) };
  }
}

export function dinhDangKhamPha(kq: KetQuaKhamPha): string {
  if (kq.trangThai === 'loi') return `Không tra được cấu trúc: ${kq.lyDo}`;
  if (kq.dong.length === 0) return 'Không tìm thấy gì khớp.';
  const dau =
    kq.hoi === 'cot' ? 'Các cột dùng được:'
      : kq.hoi === 'nut' ? 'Các nút thường dùng (còn nút khác, cứ thử tên hợp lý):'
        : 'Bảng khớp:';
  return `${dau}\n${kq.dong.slice(0, 60).map((d) => `- ${d}`).join('\n')}`;
}

export const khamPhaOdooDefinition: ToolDefinition = {
  name: 'kham_pha_odoo',
  description:
    'Hỏi Odoo xem một bảng có CỘT gì, bấm được NÚT nào, hoặc tìm tên bảng theo từ khoá. ' +
    'GỌI TRƯỚC doc_odoo/lam_odoo khi chưa chắc tên bảng hoặc tên cột — đoán bừa thì lệnh lỗi. ' +
    'hoi=cot cần bang · hoi=nut cần bang · hoi=tim_bang cần tu_khoa.',
  inputSchema: {
    type: 'object',
    properties: {
      bang: { type: 'string', description: 'Model Odoo, vd sale.order' },
      hoi: { type: 'string', enum: ['cot', 'nut', 'tim_bang'], description: 'Muốn biết gì' },
      tu_khoa: { type: 'string', description: 'Từ khoá khi hoi=tim_bang, vd "kho", "hoá đơn"' },
    },
    required: ['hoi'],
  },
};
