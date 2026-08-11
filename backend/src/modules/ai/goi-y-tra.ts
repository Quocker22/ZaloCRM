// SPDX-License-Identifier: AGPL-3.0-or-later
// Logic tra gợi ý @khách / #sản-phẩm — THUẦN Odoo, không đụng Prisma.
//
// Tách khỏi `goi-y-routes.ts` vì file đó import `authMiddleware` → kéo theo
// Prisma → test và script phải có DATABASE_URL dù chỉ tra Odoo. Tách ra thì
// test chạy được với mock Odoo, không cần hạ tầng nào.

import type { OdooClient } from './odoo/client.js';

/** Số dòng gợi ý. 8 vừa khung, nhiều hơn là phải cuộn — chậm hơn gõ tay. */
const SO_GOI_Y = 8;

/** Query ngắn hơn ngưỡng này thì không tra: khớp quá nhiều, vô nghĩa. */
export const KY_TU_TOI_THIEU = 2;

/**
 * Ngưỡng giá ảo — đồng bộ với `tra-san-pham.ts`.
 * SP giá ≤ 10đ là placeholder khi nhập liệu, không phải giá bán.
 */
const NGUONG_GIA_AO = 10;

export interface GoiYKhach {
  id: number;
  ten: string;
  maKh: string;
  sdt: string;
  congNo: number;
}

export interface GoiYSanPham {
  id: number;
  ten: string;
  ma: string;
  gia: number;
  donVi: string;
}

/** Odoo trả many2one dạng [id, "tên"]. */
function tenM2O(v: unknown): string {
  return Array.isArray(v) && v.length >= 2 ? String(v[1]) : '';
}

export async function timKhachGoiY(
  odoo: Pick<OdooClient, 'searchRead'>,
  q: string,
): Promise<GoiYKhach[]> {
  const tu = q.trim();
  if (tu.length < KY_TU_TOI_THIEU) return [];

  // Toàn số → khả năng cao là SĐT. Tra theo phone/mobile chính xác hơn tên.
  const laSo = /^\d+$/.test(tu);
  const domain = laSo
    ? ['&', ['customer_rank', '>', 0], '|', ['phone', 'like', tu], ['mobile', 'like', tu]]
    : ['&', ['customer_rank', '>', 0], '|', ['name', 'ilike', tu], ['ref', 'ilike', tu]];

  const rows = await odoo.searchRead<Record<string, unknown>>(
    'res.partner',
    domain,
    ['id', 'name', 'ref', 'phone', 'mobile', 'credit'],
    { limit: SO_GOI_Y },
  );

  return rows.map((r) => ({
    id: Number(r.id),
    ten: String(r.name ?? ''),
    maKh: String(r.ref ?? ''),
    sdt: String(r.phone || r.mobile || ''),
    // Hiện công nợ ngay trong gợi ý: nhân viên thấy khách đang nợ trước khi
    // lên đơn mới. Đây là API cho NHÂN VIÊN (có JWT), không phải cho khách.
    //
    // DÙNG `credit` (số dư phải thu chuẩn kế toán của Odoo), KHÔNG dùng
    // `incokit_receivable_balance`: field tự viết đó đo trên prod 11/08 thấy
    // SAI ở 29/40 khách nợ nhiều nhất — có khách hiện 0 mà thật ra đang nợ
    // (Led Trường An: field 2,8tr / thật 605tr). Nhân viên nhìn số 0 rồi bán
    // chịu tiếp cho khách đang nợ nửa tỷ. Xem bug 16:09 11/08 ở xuat-cong-no.ts.
    congNo: Number(r.credit ?? 0),
  }));
}

export async function timSanPhamGoiY(
  odoo: Pick<OdooClient, 'searchRead'>,
  q: string,
): Promise<GoiYSanPham[]> {
  const tu = q.trim();
  if (tu.length < KY_TU_TOI_THIEU) return [];

  const domainGoc: unknown[] = [
    ['sale_ok', '=', true],
    ['active', '=', true],
    // Lọc hàng lưu trữ ở CẢ HAI cấp — cùng lý do như tra-san-pham.ts.
    ['product_tmpl_id.active', '=', true],
  ];
  const timKiem: unknown[] = ['|', ['name', 'ilike', tu], ['default_code', 'ilike', tu]];
  const F = ['id', 'name', 'default_code', 'list_price', 'uom_id'];

  // ƯU TIÊN SP CÓ GIÁ ngay ở tầng DB — 74% catalog trống giá, lấy theo id thì
  // 8 dòng đầu thường trống hết và gợi ý thành vô dụng.
  const coGia = await odoo.searchRead<Record<string, unknown>>(
    'product.product',
    [...domainGoc, ['list_price', '>', NGUONG_GIA_AO], ...timKiem],
    F, { limit: SO_GOI_Y },
  );

  const conThieu = SO_GOI_Y - coGia.length;
  const trongGia = conThieu > 0
    ? await odoo.searchRead<Record<string, unknown>>(
        'product.product',
        [...domainGoc, ['list_price', '<=', NGUONG_GIA_AO], ...timKiem],
        F, { limit: conThieu },
      )
    : [];

  return [...coGia, ...trongGia].map((r) => ({
    id: Number(r.id),
    ten: String(r.name ?? ''),
    ma: String(r.default_code ?? ''),
    gia: Number(r.list_price ?? 0),
    donVi: tenM2O(r.uom_id),
  }));
}

