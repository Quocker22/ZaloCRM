// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: xuất công nợ khách — số nợ + danh sách hoá đơn chưa thanh toán.
//
// VÌ SAO TOOL RIÊNG (không dùng tra_khach_hang): `tra_khach_hang` chỉ trả con
// số nợ tổng. Nhân viên đi đòi nợ cần biết nợ TỪ ĐƠN NÀO, ngày nào — không thì
// phải mở Odoo tra tay, và bot thành vô dụng đúng lúc cần nhất.
//
// ⚠️ CHỈ REGISTRY NHÂN VIÊN. Công nợ là thông tin nội bộ; registry khách cố ý
// không có cả `tra_khach_hang` lẫn tool này.
//
// KHÔNG TỰ CỘNG: số nợ đọc thẳng field `incokit_receivable_balance` của Odoo,
// KHÔNG cộng amount_residual của các hoá đơn. Hai cách có thể lệch nhau (bút
// toán thủ công, thanh toán treo) và Odoo mới là nguồn đúng.

import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';

/** Số hoá đơn liệt kê tối đa. Tin Zalo dài hơn là không ai đọc. */
const HD_TOI_DA = 10;

/** Số khách tối đa liệt kê khi tên trùng. */
const KHACH_TOI_DA = 5;

export interface HoaDonNo {
  ma: string;
  ngay: string;
  conNo: number;
  tong: number;
}

export interface CongNoKhach {
  khachId: number;
  ten: string;
  maKh: string;
  sdt: string;
  congNo: number;
  hoaDon: HoaDonNo[];
  /** Tổng số HĐ chưa trả (có thể lớn hơn số đã liệt kê). */
  tongSoHd: number;
}

export type KetQuaCongNo =
  | { loai: 'ok'; duLieu: CongNoKhach }
  | { loai: 'khong_thay'; tuKhoa: string }
  | { loai: 'nhieu_khach'; danhSach: Array<{ id: number; ten: string; maKh: string; sdt: string }> };

export interface XuatCongNoDeps {
  odoo: Pick<OdooClient, 'searchRead'>;
}

/** Bỏ dấu để so khớp tên gần đúng. */
function boDau(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').trim();
}

export async function xuatCongNo(
  deps: XuatCongNoDeps,
  input: { khach_id?: number; ten?: string; sdt?: string },
): Promise<KetQuaCongNo> {
  const F = ['id', 'name', 'ref', 'phone', 'mobile', 'incokit_receivable_balance'];
  let khach: Record<string, unknown>[] = [];

  if (input.khach_id) {
    khach = await deps.odoo.searchRead('res.partner', [['id', '=', input.khach_id]], F, { limit: 1 });
  } else if (input.sdt?.trim()) {
    const sdt = input.sdt.replace(/\D/g, '');
    khach = await deps.odoo.searchRead(
      'res.partner',
      ['|', ['phone', 'like', sdt], ['mobile', 'like', sdt]],
      F, { limit: KHACH_TOI_DA + 1 },
    );
  } else if (input.ten?.trim()) {
    khach = await deps.odoo.searchRead(
      'res.partner',
      [['customer_rank', '>', 0], ['name', 'ilike', input.ten.trim()]],
      F, { limit: KHACH_TOI_DA + 1 },
    );

    // Nhiều kết quả → thử khớp CHÍNH XÁC tên (bỏ dấu) để tự chọn.
    //
    // Ca thật 2026-07-31: "Quảng Cáo Hoàng Anh" khớp cả "Quảng cáo Hoàng Nam
    // Thanh Hóa" (vì ilike khớp "Quảng cáo"), bot thấy 2 kết quả nên chuyển
    // sale — dù có MỘT khách trùng khít tên nhân viên gõ.
    if (khach.length > 1) {
      const goc = boDau(input.ten);
      const khop = khach.filter((k) => boDau(String(k.name ?? '')) === goc);
      if (khop.length === 1) khach = khop;
    }
  }

  if (khach.length === 0) {
    return { loai: 'khong_thay', tuKhoa: input.ten ?? input.sdt ?? String(input.khach_id ?? '') };
  }

  if (khach.length > 1) {
    return {
      loai: 'nhieu_khach',
      danhSach: khach.slice(0, KHACH_TOI_DA).map((k) => ({
        id: Number(k.id),
        ten: String(k.name ?? ''),
        maKh: String(k.ref ?? ''),
        sdt: String(k.phone || k.mobile || ''),
      })),
    };
  }

  const k = khach[0];
  const khachId = Number(k.id);

  // Hoá đơn bán CHƯA thanh toán hết. `payment_state != paid` bắt cả
  // partial/in_payment — nhân viên cần thấy cả đơn trả một phần.
  const hd = await deps.odoo.searchRead<Record<string, unknown>>(
    'account.move',
    [
      ['partner_id', '=', khachId],
      ['move_type', '=', 'out_invoice'],
      ['state', '=', 'posted'],
      ['payment_state', '!=', 'paid'],
    ],
    ['name', 'invoice_date', 'amount_total', 'amount_residual'],
    { limit: HD_TOI_DA * 3, order: 'invoice_date desc' },
  );

  return {
    loai: 'ok',
    duLieu: {
      khachId,
      ten: String(k.name ?? ''),
      maKh: String(k.ref ?? ''),
      sdt: String(k.phone || k.mobile || ''),
      // Đọc THẲNG field Odoo, không cộng amount_residual — xem đầu file.
      congNo: Number(k.incokit_receivable_balance ?? 0),
      hoaDon: hd.slice(0, HD_TOI_DA).map((h) => ({
        ma: String(h.name ?? ''),
        ngay: String(h.invoice_date ?? ''),
        conNo: Number(h.amount_residual ?? 0),
        tong: Number(h.amount_total ?? 0),
      })),
      tongSoHd: hd.length,
    },
  };
}

export const xuatCongNoDefinition: ToolDefinition = {
  name: 'xuat_cong_no',
  description:
    'Xuất công nợ của một khách: số tiền đang nợ + danh sách hoá đơn chưa thanh toán ' +
    '(mã, ngày, số còn nợ). ' +
    'GỌI KHI nhân viên nói: "xuất công nợ khách X", "khách X nợ bao nhiêu", ' +
    '"công nợ của X", "khách nào còn nợ đơn nào". ' +
    'Dùng tool NÀY thay vì tra_khach_hang khi cần chi tiết từng hoá đơn — ' +
    'tra_khach_hang chỉ có số tổng. ' +
    'Có SĐT thì ưu tiên sdt (chính xác nhất), không thì dùng ten.',
  inputSchema: {
    type: 'object',
    properties: {
      khach_id: { type: 'integer', description: 'id khách nếu đã biết từ lượt trước' },
      ten: { type: 'string', description: 'Tên khách, khớp gần đúng' },
      sdt: { type: 'string', description: 'Số điện thoại — chính xác hơn tên' },
    },
    required: [],
  },
};

function tien(n: number): string {
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}

/** yyyy-mm-dd → dd/mm. Năm bỏ đi cho gọn, HĐ nợ hiếm khi quá 1 năm. */
function ngay(iso: string): string {
  const [, m, d] = iso.split('-');
  return d && m ? `${d}/${m}` : iso;
}

export function dinhDangCongNo(kq: KetQuaCongNo): string {
  if (kq.loai === 'khong_thay') {
    return (
      `Không tìm thấy khách "${kq.tuKhoa}". Thử lại với tên ngắn hơn hoặc SĐT.`
    );
  }

  if (kq.loai === 'nhieu_khach') {
    const ds = kq.danhSach
      .map((k) => `- id=${k.id} | ${k.ten}${k.maKh ? ` [${k.maKh}]` : ''}${k.sdt ? ` | ${k.sdt}` : ''}`)
      .join('\n');
    return (
      `Tìm thấy ${kq.danhSach.length} khách khớp:\n${ds}\n` +
      'HỎI nhân viên chọn khách nào (nêu tên, không nêu id), rồi gọi lại tool với khach_id. ' +
      'ĐỪNG chuyển sale — chỉ cần hỏi một câu là xong.'
    );
  }

  const d = kq.duLieu;
  if (d.congNo === 0 && d.hoaDon.length === 0) {
    return `${d.ten}${d.maKh ? ` [${d.maKh}]` : ''}: KHÔNG còn công nợ.`;
  }

  const dong = [
    `${d.ten}${d.maKh ? ` [${d.maKh}]` : ''}${d.sdt ? ` · ${d.sdt}` : ''}`,
    `Công nợ: ${tien(d.congNo)}`,
  ];

  if (d.hoaDon.length > 0) {
    dong.push('', 'Hoá đơn chưa thanh toán:');
    for (const h of d.hoaDon) {
      // Nêu cả tổng khi đã trả một phần — nhân viên cần biết để đối chiếu.
      const motPhan = h.conNo < h.tong ? ` (đã trả ${tien(h.tong - h.conNo)})` : '';
      dong.push(`- ${h.ma} · ${ngay(h.ngay)} · còn ${tien(h.conNo)}${motPhan}`);
    }
    if (d.tongSoHd > d.hoaDon.length) {
      dong.push(`(còn ${d.tongSoHd - d.hoaDon.length} hoá đơn nữa)`);
    }
  } else {
    // Có nợ mà không có HĐ → nợ từ bút toán thủ công. Nói rõ, đừng để model
    // kết luận "không nợ" khi con số nói ngược lại.
    dong.push('(công nợ không đến từ hoá đơn bán — có thể là bút toán thủ công)');
  }

  dong.push('', 'Nguồn: Công nợ khách (Odoo)');
  return dong.join('\n');
}
