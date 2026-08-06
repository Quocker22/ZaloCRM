// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: BÁO CÁO LINH HOẠT — tầng 2 cho đuôi dài câu hỏi tổ hợp
// (spec báo-cáo-Zalo 06/08/2026, hướng lai hai tầng).
//
// NGUYÊN TẮC AN TOÀN: model KHÔNG viết truy vấn. Nó điền form từ DANH MỤC
// ĐÓNG (bảng/đo/nhóm/lọc); code kiểm từng giá trị, map cứng sang field Odoo,
// rồi để ODOO cộng qua read_group. Giá trị lạ → lỗi KÈM danh sách hợp lệ để
// model tự sửa (pattern registry). Model không bao giờ thấy tên field Odoo.
import type { ToolDefinition } from '../../agent/types.js';
import type { OdooClient } from '../client.js';
import { NGUONG_DINH_KEM, type BangExcel } from '../xuat-excel.js';

/* ── Danh mục đóng ─────────────────────────────────────────────────────── */

const CAU_HINH = {
  don_hang: {
    model: 'sale.order',
    // Bộ lọc nền BẮT BUỘC: loại đơn huỷ — trừ khi hỏi rõ trang_thai='huy'.
    nen: [['state', '!=', 'cancel']] as unknown[],
    ngay: 'date_order',
    do: {
      tong_tien: 'amount_total',
      so_don: '__count',
      so_khach: 'partner_id:count_distinct',
    } as Record<string, string>,
    nhom: {
      nhan_vien: 'user_id',
      khach: 'partner_id',
      ngay: 'date_order:day',
      thang: 'date_order:month',
    } as Record<string, string>,
    khachField: 'partner_id',
    tienField: 'amount_total',
  },
  dong_don: {
    model: 'sale.order.line',
    nen: [['order_id.state', '!=', 'cancel']] as unknown[],
    ngay: 'create_date',
    do: {
      so_luong: 'product_uom_qty',
      tong_tien: 'price_total',
    } as Record<string, string>,
    nhom: {
      san_pham: 'product_id',
      nhan_vien: 'salesman_id',
      khach: 'order_partner_id',
      ngay: 'create_date:day',
      thang: 'create_date:month',
    } as Record<string, string>,
    khachField: 'order_partner_id',
    sanPhamField: 'product_id',
    tienField: 'price_total',
  },
  khach_hang: {
    model: 'res.partner',
    nen: [['customer_rank', '>', 0]] as unknown[],
    ngay: 'create_date',
    do: { so_khach: '__count' } as Record<string, string>,
    nhom: {
      ngay: 'create_date:day',
      thang: 'create_date:month',
    } as Record<string, string>,
  },
  ton_kho: {
    model: 'stock.quant',
    nen: [['location_id.usage', '=', 'internal']] as unknown[],
    ngay: 'in_date',
    do: { so_luong: 'quantity' } as Record<string, string>,
    nhom: { san_pham: 'product_id' } as Record<string, string>,
    sanPhamField: 'product_id',
  },
} as const;

type TenBang = keyof typeof CAU_HINH;

/** Trạng thái đơn tiếng Việt → state Odoo. Truyền trang_thai là THAY lọc nền. */
const TRANG_THAI: Record<string, string> = {
  nhap: 'draft', xac_nhan: 'sale', hoan_thanh: 'done', huy: 'cancel',
};

const TRAN_DONG = 200;

export interface BaoCaoLinhHoatInput {
  bang?: string;
  do?: string;
  nhom_theo?: string;
  tu_ngay?: string;
  den_ngay?: string;
  trang_thai?: string;
  khach_id?: number;
  san_pham_id?: number;
  nguong_tien?: number;
  sap_xep?: string;
  gioi_han?: number;
}

export interface DongBaoCao {
  nhan: string;
  giaTri: number;
}

export type KetQuaLinhHoat =
  | { trangThai: 'ok'; danhSach: DongBaoCao[]; tong: number; moTa: string }
  | { trangThai: 'loi'; lyDo: string };

export interface LinhHoatDeps {
  odoo: Pick<OdooClient, 'execute'>;
}

function ngayHopLe(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Lỗi nói được "phải làm gì" — model đọc lỗi tool tốt hơn đọc prompt. */
function loi(lyDo: string): KetQuaLinhHoat {
  return { trangThai: 'loi', lyDo };
}

export async function baoCaoLinhHoat(
  deps: LinhHoatDeps,
  input: BaoCaoLinhHoatInput,
): Promise<KetQuaLinhHoat> {
  // ── Kiểm whitelist — TỪNG giá trị, lỗi nào cũng kèm danh sách hợp lệ ──
  const bang = input.bang as TenBang;
  if (!bang || !(bang in CAU_HINH)) {
    return loi(`bang='${input.bang}' không hợp lệ. Chọn một trong: ${Object.keys(CAU_HINH).join(', ')}.`);
  }
  const ch = CAU_HINH[bang];

  const doKey = input.do ?? '';
  const doField = (ch.do as Record<string, string>)[doKey];
  if (!doField) {
    return loi(`do='${input.do}' không hợp lệ với bang='${bang}'. Chọn: ${Object.keys(ch.do).join(', ')}.`);
  }

  const nhomKey = input.nhom_theo ?? '';
  const nhomField = (ch.nhom as Record<string, string>)[nhomKey];
  if (!nhomField) {
    return loi(`nhom_theo='${input.nhom_theo}' không hợp lệ với bang='${bang}'. Chọn: ${Object.keys(ch.nhom).join(', ')}.`);
  }

  // ── Dựng domain: lọc nền + lọc người dùng, mỗi khoá validate riêng ──
  const domain: unknown[] = [];

  if (input.trang_thai !== undefined) {
    if (!('tienField' in ch)) return loi(`trang_thai chỉ dùng được với bang='don_hang' hoặc 'dong_don'.`);
    const state = TRANG_THAI[input.trang_thai];
    if (!state) return loi(`trang_thai='${input.trang_thai}' không hợp lệ. Chọn: ${Object.keys(TRANG_THAI).join(', ')}.`);
    domain.push([bang === 'dong_don' ? 'order_id.state' : 'state', '=', state]);
  } else {
    domain.push(...ch.nen);
  }

  if (input.tu_ngay !== undefined) {
    if (!ngayHopLe(input.tu_ngay)) return loi(`tu_ngay='${input.tu_ngay}' sai định dạng, cần YYYY-MM-DD.`);
    domain.push([ch.ngay, '>=', `${input.tu_ngay} 00:00:00`]);
  }
  if (input.den_ngay !== undefined) {
    if (!ngayHopLe(input.den_ngay)) return loi(`den_ngay='${input.den_ngay}' sai định dạng, cần YYYY-MM-DD.`);
    domain.push([ch.ngay, '<=', `${input.den_ngay} 23:59:59`]);
  }

  if (input.khach_id !== undefined) {
    if (!('khachField' in ch)) return loi(`khach_id không dùng được với bang='${bang}'.`);
    if (!Number.isInteger(input.khach_id) || input.khach_id <= 0) return loi('khach_id phải là số nguyên dương (lấy từ tra_khach_hang).');
    domain.push([(ch as { khachField: string }).khachField, '=', input.khach_id]);
  }
  if (input.san_pham_id !== undefined) {
    if (!('sanPhamField' in ch)) return loi(`san_pham_id không dùng được với bang='${bang}'.`);
    if (!Number.isInteger(input.san_pham_id) || input.san_pham_id <= 0) return loi('san_pham_id phải là số nguyên dương (lấy từ tra_san_pham).');
    domain.push([(ch as { sanPhamField: string }).sanPhamField, '=', input.san_pham_id]);
  }
  if (input.nguong_tien !== undefined) {
    if (!('tienField' in ch)) return loi(`nguong_tien chỉ dùng được với bang='don_hang' hoặc 'dong_don'.`);
    if (!Number.isFinite(input.nguong_tien) || input.nguong_tien < 0) return loi('nguong_tien phải là số không âm.');
    domain.push([(ch as { tienField: string }).tienField, '>=', input.nguong_tien]);
  }

  const gioiHan = Math.min(Math.max(1, input.gioi_han ?? 50), TRAN_DONG);

  // ── Odoo cộng — read_group, KHÔNG kéo bản ghi thô về ──
  const laCount = doField === '__count';
  const fieldGoc = doField.split(':')[0];
  const fields = laCount ? [] : [`${fieldGoc}:${doField.includes(':') ? doField.split(':')[1] : 'sum'}`];

  try {
    const nhom = await deps.odoo.execute<Array<Record<string, unknown>>>(
      ch.model,
      'read_group',
      [domain, fields, [nhomField]],
      { lazy: true },
    );

    const tenNhomGoc = nhomField.split(':')[0];
    let danhSach: DongBaoCao[] = nhom.map((g) => {
      const raw = g[nhomField] ?? g[tenNhomGoc];
      const nhan = Array.isArray(raw) ? String(raw[1] ?? raw[0]) : String(raw ?? '(trống)');
      const giaTri = laCount
        ? Number(g[`${tenNhomGoc}_count`] ?? g.__count ?? 0)
        : Number(g[fieldGoc] ?? 0);
      return { nhan, giaTri };
    });

    danhSach.sort((a, b) => (input.sap_xep === 'tang' ? a.giaTri - b.giaTri : b.giaTri - a.giaTri));
    const tong = danhSach.reduce((t, d) => t + d.giaTri, 0);
    danhSach = danhSach.slice(0, gioiHan);

    const moTa =
      `${bang} · đo ${doKey} · nhóm theo ${nhomKey}` +
      (input.tu_ngay || input.den_ngay ? ` · kỳ ${input.tu_ngay ?? '…'} – ${input.den_ngay ?? '…'}` : ' · toàn bộ thời gian') +
      (input.trang_thai ? ` · trạng thái ${input.trang_thai}` : '');

    return { trangThai: 'ok', danhSach, tong, moTa };
  } catch (err) {
    return loi(`Odoo từ chối truy vấn: ${err instanceof Error ? err.message.slice(0, 150) : String(err)}`);
  }
}

export function bangLinhHoat(kq: Extract<KetQuaLinhHoat, { trangThai: 'ok' }>): BangExcel {
  return {
    tieuDe: `Báo cáo: ${kq.moTa}`,
    cot: ['Nhóm', 'Giá trị'],
    dong: kq.danhSach.map((d) => [d.nhan, d.giaTri]),
    tongCong: ['TỔNG', kq.tong],
  };
}

export function dinhDangLinhHoat(kq: KetQuaLinhHoat, daDinhKem = false): string {
  if (kq.trangThai === 'loi') return `Không chạy được báo cáo: ${kq.lyDo}`;
  if (kq.danhSach.length === 0) {
    return `Không có dữ liệu cho báo cáo (${kq.moTa}). Kỳ này thật sự trống — đừng đoán số.`;
  }
  const hien = kq.danhSach.slice(0, daDinhKem ? 5 : NGUONG_DINH_KEM);
  const dong = hien.map((d) => `- ${d.nhan}: ${d.giaTri.toLocaleString('vi-VN')}`).join('\n');
  return (
    `Báo cáo (${kq.moTa}) — TỔNG: ${kq.tong.toLocaleString('vi-VN')}\n` +
    dong +
    (daDinhKem ? `\n... Đã gửi kèm FILE EXCEL đầy đủ ${kq.danhSach.length} dòng (tải về mở được) và một ảnh xem nhanh. Nói "xem file Excel đính kèm ạ".` : '')
  );
}

export const baoCaoLinhHoatDefinition: ToolDefinition = {
  name: 'bao_cao_linh_hoat',
  description:
    'GỌI KHI câu hỏi báo cáo TỔ HỢP không vừa các tool báo cáo có sẵn. Ví dụ: ' +
    '"khách nào mua nhiều hàng nhất / mua trên 5 triệu tháng này" (bang=don_hang, do=tong_tien, nhom_theo=khach), ' +
    '"doanh thu theo từng nhân viên tuần trước" (bang=don_hang, do=tong_tien, nhom_theo=nhan_vien), ' +
    '"mỗi tháng thêm bao nhiêu khách mới" (bang=khach_hang, do=so_khach, nhom_theo=thang). ' +
    'Hễ hỏi "AI/CÁI GÌ nhiều nhất, theo từng X" mà không có tool chuyên → dùng tool NÀY, đừng bỏ cuộc. ' +
    'KHÔNG dùng khi đã có tool chuyên: doanh thu tổng kỳ (bao_cao_tong_quan), top SẢN PHẨM (top_san_pham), ' +
    'tồn sắp hết (canh_bao_ton_kho), công nợ (xuat_cong_no), đơn chờ (don_cho_xac_nhan).',
  inputSchema: {
    type: 'object',
    properties: {
      bang: { type: 'string', enum: ['don_hang', 'dong_don', 'khach_hang', 'ton_kho'], description: 'Nguồn dữ liệu. don_hang=đơn bán; dong_don=từng dòng sản phẩm trong đơn; khach_hang=danh bạ khách; ton_kho=tồn hiện tại.' },
      do: { type: 'string', enum: ['tong_tien', 'so_luong', 'so_don', 'so_khach'], description: 'Đo gì. don_hang: tong_tien/so_don/so_khach · dong_don: so_luong/tong_tien · khach_hang: so_khach · ton_kho: so_luong.' },
      nhom_theo: { type: 'string', enum: ['nhan_vien', 'khach', 'san_pham', 'ngay', 'thang'], description: 'Nhóm kết quả theo gì. san_pham chỉ với dong_don/ton_kho.' },
      tu_ngay: { type: 'string', description: 'YYYY-MM-DD' },
      den_ngay: { type: 'string', description: 'YYYY-MM-DD' },
      trang_thai: { type: 'string', enum: ['nhap', 'xac_nhan', 'hoan_thanh', 'huy'], description: 'Chỉ don_hang/dong_don. Bỏ trống = mọi trạng thái trừ huỷ.' },
      khach_id: { type: 'number', description: 'Lọc theo một khách (id từ tra_khach_hang).' },
      san_pham_id: { type: 'number', description: 'Lọc theo một SP (id từ tra_san_pham).' },
      nguong_tien: { type: 'number', description: 'Chỉ lấy dòng có tiền >= ngưỡng này.' },
      sap_xep: { type: 'string', enum: ['giam', 'tang'], description: 'Mặc định giảm dần.' },
      gioi_han: { type: 'number', description: 'Số dòng (mặc định 50, trần 200).' },
    },
    required: ['bang', 'do', 'nhom_theo'],
  },
};
