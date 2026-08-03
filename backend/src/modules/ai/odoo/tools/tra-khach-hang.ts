// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: tìm khách hàng trong Odoo theo số điện thoại.
//
// Vấn đề đã khảo sát: `phone` trong res.partner KHÔNG chuẩn hoá, KHÔNG unique.
// Không có module phone_validation, không có index unique. Nghĩa là cùng một
// người có thể nằm dưới "0912345678", "+84912345678", "0912 345 678".
// Ta phải tự thử nhiều dạng.
//
// QUY TẮC TUYỆT ĐỐI: tool này KHÔNG BAO GIỜ tạo res.partner mới.
// Không tìm thấy → chuyển sale. Khách trùng lặp là rác dữ liệu vĩnh viễn, và
// đối chiếu công nợ về sau sẽ sai. Thà để người xử lý 30 giây còn hơn tạo rác.

import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';
import { normalizeVnPhone } from '../../../../shared/phone/normalize-vn-phone.js';

export interface KhachHang {
  id: number;
  ten: string;
  ma: string | null;      // ref — mã KH, vd KH00001 (đây mới là khoá unique thật)
  dienThoai: string | null;
  congNo: number;         // số khách đang nợ mình
}

export type KetQuaTimKhach =
  | { trangThai: 'tim_thay'; khach: KhachHang }
  | { trangThai: 'khong_thay'; sdtDaTra: string[] }
  | { trangThai: 'nhieu_ket_qua'; danhSach: KhachHang[] };

export interface TraKhachHangDeps {
  odoo: Pick<OdooClient, 'searchRead'>;
}

/**
 * Sinh các biến thể SĐT để tra Odoo.
 *
 * Vì DB lưu tự do nên phải thử: local (0912…), E164 (+84912…), và dạng 84912…
 * Trả về mảng đã khử trùng lặp.
 */
export function bienTheSdt(raw: string): string[] {
  const kq = normalizeVnPhone(raw);
  if (!kq.valid || !kq.phoneE164) {
    // Không parse được → vẫn thử nguyên văn, biết đâu DB lưu đúng như vậy.
    const s = raw.trim();
    return s ? [s] : [];
  }
  const e164 = kq.phoneE164;              // +84912345678
  const local = kq.phoneLocal ?? '';      // 0912345678
  const khongCong = e164.replace(/^\+/, ''); // 84912345678
  return [...new Set([local, e164, khongCong].filter(Boolean))];
}

/**
 * Tìm khách theo SĐT. Chỉ ĐỌC.
 *
 * Ba kết quả có thể:
 *  - tim_thay      → 1 khách duy nhất, dùng được
 *  - khong_thay    → model phải chuyển sale, KHÔNG được tự tạo
 *  - nhieu_ket_qua → dữ liệu trùng, người phải chọn
 */
export async function traKhachHang(
  deps: TraKhachHangDeps,
  input: { sdt?: string; ten?: string },
): Promise<KetQuaTimKhach> {
  const sdt = (input.sdt ?? '').trim();
  const ten = (input.ten ?? '').trim();

  // Không có gì để tra.
  if (!sdt && !ten) return { trangThai: 'khong_thay', sdtDaTra: [] };

  let dieuKien: unknown[];
  let bienThe: string[] = [];

  if (sdt) {
    bienThe = bienTheSdt(sdt);
    if (bienThe.length === 0) return { trangThai: 'khong_thay', sdtDaTra: [] };
    // phone in [...] OR mobile in [...]
    dieuKien = ['|', ['phone', 'in', bienThe], ['mobile', 'in', bienThe]];
  } else {
    // TRA THEO TÊN — tách từ khoá, mỗi từ một điều kiện AND.
    // Cùng lý do như tra_san_pham: "qc hoàng sơn" phải khớp được cả khi tên
    // trong DB có thêm chữ ở giữa. Nhân viên gõ tên gần đúng là chuyện bình thường.
    const tu = ten.split(/\s+/).filter((t) => t.length >= 2);
    dieuKien = tu.length <= 1
      ? [['name', 'ilike', ten]]
      : [...Array(tu.length - 1).fill('&'), ...tu.map((t) => ['name', 'ilike', t])];
  }

  const rows = await deps.odoo.searchRead<Record<string, unknown>>(
    'res.partner',
    ['&', ['customer_rank', '>', 0], ...dieuKien],
    ['id', 'name', 'ref', 'phone', 'mobile', 'incokit_receivable_balance'],
    { limit: 10 },
  );

  const danhSach: KhachHang[] = rows.map((r) => ({
    id: Number(r.id),
    ten: String(r.name ?? ''),
    ma: r.ref ? String(r.ref) : null,
    dienThoai: (r.phone ? String(r.phone) : null) ?? (r.mobile ? String(r.mobile) : null),
    congNo: Number(r.incokit_receivable_balance ?? 0),
  }));

  if (danhSach.length === 0) return { trangThai: 'khong_thay', sdtDaTra: bienThe };
  if (danhSach.length === 1) return { trangThai: 'tim_thay', khach: danhSach[0] };

  return { trangThai: 'nhieu_ket_qua', danhSach };
}



export const traKhachHangDefinition: ToolDefinition = {
  name: 'tra_khach_hang',
  description:
    'Tìm khách hàng trong hệ thống theo SỐ ĐIỆN THOẠI hoặc TÊN. Trả về id, tên, mã KH và công nợ. ' +
    'GỌI KHI: cần lên đơn cho khách, hoặc cần biết khách đã có trong hệ thống chưa. ' +
    'Có SĐT thì ưu tiên dùng sdt (chính xác hơn); chỉ biết tên thì dùng ten. ' +
    'LƯU Ý: tool này CHỈ TRA, không tạo khách mới. Nếu không tìm thấy, phải chuyển sale ' +
    'để người tạo khách — tuyệt đối không tự bịa id khách.',
  inputSchema: {
    type: 'object',
    properties: {
      sdt: { type: 'string', description: 'Số điện thoại khách, dạng nào cũng được (0912…, +84912…)' },
      ten: { type: 'string', description: 'Tên khách, gõ gần đúng cũng được. Vd "hoàng sơn", "chị Lan"' },
    },
    // Không required: phải có ÍT NHẤT MỘT trong hai, kiểm ở code.
  },
};

/**
 * Định dạng cho LLM.
 * Với 2 nhánh không-dùng-được, câu chữ phải NÓI RÕ phải làm gì tiếp — model đọc
 * hướng dẫn trong tool result tốt hơn nhiều so với đọc quy tắc trong system prompt.
 */
export function dinhDangKhachHang(kq: KetQuaTimKhach): string {
  if (kq.trangThai === 'khong_thay') {
    const daThu = kq.sdtDaTra.length > 0
      ? `SĐT đã thử: ${kq.sdtDaTra.join(', ')}`
      : 'đã tra theo tên';
    return (
      `Không tìm thấy khách (${daThu}). ` +
      'Nếu mới chỉ tra theo SĐT, hãy thử lại với tham số `ten`. ' +
      'Vẫn không thấy → KHÔNG được tự tạo khách, hãy dùng chuyen_sale để người tạo khách mới.'
    );
  }
  if (kq.trangThai === 'nhieu_ket_qua') {
    const ds = kq.danhSach
      .map((k) => `- id=${k.id} | ${k.ten}${k.ma ? ` [${k.ma}]` : ''} | ${k.dienThoai ?? 'không có SĐT'}`)
      .join('\n');
    return (
      `Tìm thấy ${kq.danhSach.length} khách khớp:\n${ds}\n` +
      'KHÔNG tự chọn. Nếu nhân viên có SĐT chính xác, tra lại bằng `sdt` để ra đúng một người. ' +
      'Không có SĐT → liệt kê danh sách này cho nhân viên chọn, hoặc dùng chuyen_sale.'
    );
  }
  const k = kq.khach;
  const no = k.congNo > 0 ? ` | đang nợ ${k.congNo.toLocaleString('vi-VN')}đ` : '';
  return `id=${k.id} | ${k.ten}${k.ma ? ` [${k.ma}]` : ''} | ${k.dienThoai ?? ''}${no}`;
}
