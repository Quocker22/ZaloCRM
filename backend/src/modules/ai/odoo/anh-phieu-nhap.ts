// SPDX-License-Identifier: AGPL-3.0-or-later
// ẢNH PHIẾU NHẬP tự vẽ (16/08). Odoo prod KHÔNG có report custom nào cho
// purchase.order (đo: chỉ 2 mẫu chuẩn), nên render qua report ra "Yêu cầu báo
// giá" tiếng-Odoo — anh Quốc: "ủa phiếu này đâu phải phiếu custom của tôi".
// Tự vẽ bằng bộ render bảng sẵn có (anh-bang, cùng bộ với ảnh báo cáo) —
// mình cầm khuôn, Odoo đổi template cũng không vỡ.
import type { OdooClient } from './client.js';
import { bangRaAnh } from './anh-bang.js';
import type { BangExcel } from './xuat-excel.js';

const tien = (n: number): string => `${Math.round(n).toLocaleString('vi-VN')}đ`;

/** Dựng BangExcel từ dữ liệu phiếu — thuần để test khoá nội dung. */
export function bangPhieuNhap(
  don: { ma: string; ncc: string; ngay?: string },
  dong: Array<{ ten: string; sl: number; gia: number; thanhTien: number }>,
): BangExcel {
  return {
    tieuDe: `PHIẾU NHẬP HÀNG ${don.ma} — NCC ${don.ncc}`,
    ky: don.ngay ?? '',
    cot: ['Tên hàng', 'SL', 'Giá nhập', 'Thành tiền'],
    dong: dong.map((d) => [
      d.ten,
      d.sl.toLocaleString('vi-VN'),
      d.gia > 0 ? tien(d.gia) : 'chưa có',
      d.thanhTien > 0 ? tien(d.thanhTien) : '—',
    ]),
    tongCong: ['TỔNG', '', '', tien(dong.reduce((t, d) => t + d.thanhTien, 0))],
  };
}

/** Đọc phiếu từ Odoo rồi vẽ PNG. Lỗi → null (best-effort, caller chỉ log). */
export async function anhPhieuNhap(
  odoo: Pick<OdooClient, 'searchRead'>,
  donId: number,
): Promise<{ duLieu: Buffer; tenFile: string } | null> {
  const [don] = await odoo.searchRead<Record<string, unknown>>(
    'purchase.order', [['id', '=', donId]], ['name', 'partner_id', 'date_order'], { limit: 1 },
  );
  if (!don) return null;
  const lines = await odoo.searchRead<Record<string, unknown>>(
    'purchase.order.line', [['order_id', '=', donId]],
    ['product_id', 'product_qty', 'price_unit', 'price_subtotal'], { limit: 60 },
  );
  const bang = bangPhieuNhap(
    {
      ma: String(don.name ?? ''),
      ncc: Array.isArray(don.partner_id) ? String(don.partner_id[1]) : '',
      ngay: don.date_order ? String(don.date_order).slice(0, 10) : '',
    },
    lines
      .filter((l) => Array.isArray(l.product_id))
      .map((l) => ({
        ten: String((l.product_id as [number, string])[1] ?? ''),
        sl: Number(l.product_qty ?? 0),
        gia: Number(l.price_unit ?? 0),
        thanhTien: Number(l.price_subtotal ?? 0),
      })),
  );
  const duLieu = await bangRaAnh(bang, 40);
  return { duLieu, tenFile: `phieu-nhap-${String(don.name ?? donId)}.png` };
}
