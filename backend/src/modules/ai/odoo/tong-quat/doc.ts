// SPDX-License-Identifier: AGPL-3.0-or-later
// doc_odoo — ĐỌC bất cứ gì trong Odoo, không cần khai trước.
//
// Sinh từ câu thật 17:52 10/08: "doanh số chi tiết theo từng sản phẩm" — nghiệp
// vụ bình thường mà bot chịu, vì bao_cao_linh_hoat chỉ mở vài bảng/chiều khai
// sẵn. Cứ mỗi câu hỏi mới lại viết một tool là cách chắc chắn để hệ thống phình
// ra không kiểm soát nổi.
//
// Ánh xạ thẳng sang hai lệnh đọc của Odoo:
//   không nhóm → search_read   (danh sách bản ghi)
//   có nhóm    → read_group    (mọi báo cáo tổng hợp đều dựa vào cái này)
import type { ToolDefinition } from '../../agent/types.js';
import type { OdooClient } from '../client.js';
import { locCotCam } from './an-toan.js';

/** Trần dòng trả về — nhét cả nghìn dòng vào ngữ cảnh LLM là đốt tiền vô ích. */
const TRAN_DONG = 200;
const MAC_DINH_DONG = 50;
/** Số dòng in ra cho model đọc; phần dư chỉ nói số lượng. */
const DONG_HIEN = 30;

export interface DocOdooDeps {
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
}

export interface DocOdooInput {
  bang: string;
  loc?: unknown[];
  cot?: string[];
  nhom_theo?: string[];
  do?: string[];
  sap_xep?: string;
  gioi_han?: number;
}

export type KetQuaDoc =
  | { trangThai: 'ok'; dong: Array<Record<string, unknown>>; soDong: number }
  | { trangThai: 'loi'; lyDo: string };

export async function docOdoo(deps: DocOdooDeps, input: DocOdooInput): Promise<KetQuaDoc> {
  const bang = (input.bang ?? '').trim();
  if (!bang) {
    return { trangThai: 'loi', lyDo: 'Thiếu tên bảng Odoo. Không rõ bảng nào thì dùng kham_pha_odoo trước.' };
  }

  // Chặn cột nhạy cảm TRƯỚC khi gọi Odoo — user bot có quyền kế toán đầy đủ,
  // Odoo sẽ không chặn giúp mình.
  const camTatCa = [
    ...locCotCam(input.cot ?? []).cam,
    ...locCotCam(input.do ?? []).cam,
    ...locCotCam(input.nhom_theo ?? []).cam,
  ];
  if (camTatCa.length > 0) {
    return {
      trangThai: 'loi',
      lyDo:
        `Không được đọc cột: ${camTatCa.join(', ')}. Đây là giá vốn/biên lợi nhuận — ` +
        'thông tin nội bộ, không đưa ra chat. Dùng cột giá bán (list_price) hoặc doanh thu thay thế.',
    };
  }

  const gioiHan = Math.min(Math.max(1, input.gioi_han ?? MAC_DINH_DONG), TRAN_DONG);

  try {
    // ── Có nhóm → read_group: mọi báo cáo tổng hợp đi đường này ──
    if (input.nhom_theo && input.nhom_theo.length > 0) {
      // Tham số 2 của read_group là các cột CẦN CỘNG (+ cột nhóm), KHÔNG phải
      // `cot`. Bug thật 19:03 10/08: model truyền cả `cot` lẫn `do` → Odoo ném
      // "too many values to unpack" và bot mò tiếp cho tới khi hết 90s.
      // Cột nhóm dạng "date:month" phải bỏ phần ":month" khi khai trong fields.
      const doDac = input.do ?? [];
      const truongNhom = input.nhom_theo.map((n) => n.split(':')[0]);
      const fields = [...new Set([...doDac, ...truongNhom])];
      const dong = await deps.odoo.execute<Array<Record<string, unknown>>>(
        bang,
        'read_group',
        [input.loc ?? [], fields, input.nhom_theo],
        { lazy: false, limit: gioiHan, ...(input.sap_xep ? { orderby: input.sap_xep } : {}) },
      );
      const ds = Array.isArray(dong) ? dong : [];
      return { trangThai: 'ok', dong: ds, soDong: ds.length };
    }

    // ── Không nhóm → search_read ──
    const dong = await deps.odoo.searchRead<Record<string, unknown>>(
      bang,
      input.loc ?? [],
      input.cot ?? ['id', 'display_name'],
      { limit: gioiHan, ...(input.sap_xep ? { order: input.sap_xep } : {}) },
    );
    return { trangThai: 'ok', dong, soDong: dong.length };
  } catch (err) {
    // Báo nguyên văn: nhân viên đọc "bảng lạ" còn biết đường gõ lại, hơn là
    // nhận một câu chung chung rồi ngồi đoán.
    return { trangThai: 'loi', lyDo: err instanceof Error ? err.message : String(err) };
  }
}

/** Rút gọn many2one dạng [id, "tên"] → "tên" cho người đọc. */
function gonGang(v: unknown): string {
  if (Array.isArray(v) && v.length >= 2) return String(v[1]);
  if (typeof v === 'number') return v.toLocaleString('vi-VN');
  return String(v ?? '');
}

export function dinhDangDoc(kq: KetQuaDoc): string {
  if (kq.trangThai === 'loi') return `Không đọc được: ${kq.lyDo}`;
  if (kq.soDong === 0) {
    // RỖNG ≠ LỖI (luật cũ của các tool báo cáo): kỳ không phát sinh là chuyện
    // bình thường, nói "lỗi" làm nhân viên tưởng hệ thống hỏng.
    return 'Không có dữ liệu cho truy vấn này (kỳ hoặc điều kiện có thể không có phát sinh).';
  }
  const hien = kq.dong.slice(0, DONG_HIEN).map((d) => {
    const cap = Object.entries(d)
      .filter(([k]) => k !== '__domain' && k !== '__context' && k !== '__range')
      .map(([k, v]) => `${k}=${gonGang(v)}`);
    return '- ' + cap.join(' · ');
  });
  const con = kq.soDong > DONG_HIEN ? `\n(còn ${kq.soDong - DONG_HIEN} dòng nữa)` : '';
  return `${kq.soDong} dòng:\n${hien.join('\n')}${con}`;
}

export const docOdooDefinition: ToolDefinition = {
  name: 'doc_odoo',
  description:
    'ĐỌC bất cứ dữ liệu nào trong Odoo — dùng khi không có tool báo cáo sẵn cho câu hỏi. ' +
    'GỌI KHI nhân viên hỏi số liệu tổ hợp: "doanh số theo từng sản phẩm của khách X", ' +
    '"khách nào mua nhiều nhất quý 2", "đơn nào chưa giao tháng này". ' +
    'Có nhom_theo → báo cáo gộp: chỉ điền do (cột cần cộng), ĐỪNG điền cot. '
    + 'Không có nhom_theo → danh sách bản ghi, điền cot. ' +
    'Không rõ tên bảng/cột thì gọi kham_pha_odoo trước. ' +
    'KHÔNG đọc được giá vốn/biên lợi nhuận — đó là thông tin nội bộ.',
  inputSchema: {
    type: 'object',
    properties: {
      bang: { type: 'string', description: 'Tên model Odoo: sale.order, res.partner, sale.report…' },
      loc: {
        type: 'array',
        description: 'Domain Odoo, vd [["partner_id","=",76],["date",">=","2026-08-01"]]',
        items: {},
      },
      cot: { type: 'array', items: { type: 'string' }, description: 'Cột cần lấy (khi KHÔNG nhóm)' },
      nhom_theo: { type: 'array', items: { type: 'string' }, description: 'Gộp theo cột nào: product_id, partner_id, date:month' },
      do: { type: 'array', items: { type: 'string' }, description: 'Cột cần cộng khi nhóm: price_total, product_uom_qty' },
      sap_xep: { type: 'string', description: 'vd "price_total desc"' },
      gioi_han: { type: 'integer', description: `Số dòng, mặc định ${MAC_DINH_DONG}, tối đa ${TRAN_DONG}` },
    },
    required: ['bang'],
  },
};
