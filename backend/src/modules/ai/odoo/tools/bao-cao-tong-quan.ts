// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: báo cáo tổng quan (KPI + top sản phẩm + top khách).
//
// VÌ SAO TOOL NÀY TỒN TẠI: sếp muốn biết "tháng này thế nào" mà không phải mở
// Odoo. Trước đây bot không có tool nào tổng hợp nên chuyển sale — đúng câu hỏi
// mà bot đáng lẽ trả lời được ngay.
//
// LUẬT CỨNG — BOT KHÔNG BAO GIỜ TỰ TÍNH TỔNG:
// Tool này CHỈ gọi `get_dashboard_data()` rồi định dạng. Không SQL, không
// .reduce() cộng tiền, không tự tính %. Ba bug đắt nhất lịch sử hệ này đều là
// bug ĐỌC/TỔNG HỢP: bridge cộng đôi 1,45 tỷ · footer tính lifetime (5,6 tỷ so
// với 21 tỷ thật) · tổng bán thổi phồng 206 tỷ vì đếm cả hoá đơn "Đã hủy".
// Ghi sai thì thấy ngay; SỐ SAI thì lãnh đạo tin và quyết định theo.

import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';

/** Số dòng top tối đa. Tin Zalo dài hơn là không ai đọc hết. */
const TOP_TOI_DA = 5;

/**
 * Field TUYỆT ĐỐI không đưa cho LLM.
 *
 * `inventory_value` chứa `cost` từng sản phẩm — đó là GIÁ VỐN. Odoo đã bảo vệ
 * `standard_price` bằng `groups="incokit_pos.group_manager"` ở tầng field,
 * nhưng đây là hàng rào thứ hai: nếu ai đó lỡ cấp group_manager cho user bot,
 * code vẫn không lộ. Cùng nguyên tắc danh sách trắng của `tra_san_pham`.
 */
const FIELD_CAM = ['inventory_value', 'low_stock_html'] as const;

export interface KpiTongQuan {
  soHoaDon: number;
  doanhThu: number;
  soPhieuTra: number;
  tienTraHang: number;
  /** % so với kỳ trước, Odoo đã cap ±999. */
  soVoiKyTruoc: number;
  doanhThuKyTruoc: number;
}

export interface DongTop {
  ten: string;
  giaTri: number;
}

export interface BaoCaoTongQuan {
  kpi: KpiTongQuan;
  topSanPham: DongTop[];
  topKhachHang: DongTop[];
  topNhanVien: DongTop[];
  tuNgay: string;
  denNgay: string;
  ky: string;
}

export interface BaoCaoTongQuanDeps {
  odoo: Pick<OdooClient, 'execute'>;
}

/** Preset hợp lệ của Odoo. Truyền sai thì Odoo im lặng trả kỳ mặc định. */
export const KY_HOP_LE = [
  'today', 'yesterday', 'last_7_days', 'this_month', 'last_month',
] as const;
export type KyBaoCao = (typeof KY_HOP_LE)[number];

/** Đọc mảng top — Odoo trả [{label, value}]. */
function docTop(v: unknown): DongTop[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, TOP_TOI_DA).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return { ten: String(o.label ?? ''), giaTri: Number(o.value ?? 0) };
  });
}

export async function baoCaoTongQuan(
  deps: BaoCaoTongQuanDeps,
  input: { ky?: string } = {},
): Promise<BaoCaoTongQuan> {
  // Preset lạ → dùng this_month. KHÔNG truyền thẳng chuỗi của model xuống Odoo:
  // Odoo nhận preset không nhận ra sẽ lặng lẽ trả kỳ khác, và bot báo số của
  // kỳ sai mà không ai biết.
  const ky = (KY_HOP_LE as readonly string[]).includes(input.ky ?? '')
    ? (input.ky as KyBaoCao)
    : 'this_month';

  // args = [] (KHÔNG [[]]) — xem giải thích ở canh-bao-ton-kho.ts.
  const r = await deps.odoo.execute<Record<string, unknown>>(
    'incokit.dashboard_overview',
    'get_dashboard_data',
    [],
    { time_preset: ky },
  );

  // Hàng rào: xoá field nhạy cảm NGAY khi nhận, trước mọi xử lý khác.
  const sach = { ...(r ?? {}) };
  for (const f of FIELD_CAM) delete sach[f];

  const k = (sach.kpi ?? {}) as Record<string, unknown>;
  const tr = (sach.time_range ?? {}) as Record<string, unknown>;

  return {
    kpi: {
      soHoaDon: Number(k.invoice_count ?? 0),
      doanhThu: Number(k.revenue ?? 0),
      soPhieuTra: Number(k.refund_count ?? 0),
      tienTraHang: Number(k.refund_amount ?? 0),
      soVoiKyTruoc: Number(k.delta_prev ?? 0),
      doanhThuKyTruoc: Number(k.prev_revenue ?? 0),
    },
    topSanPham: docTop(sach.top_products),
    topKhachHang: docTop(sach.top_customers),
    topNhanVien: docTop(sach.top_staff),
    // Odoo trả false khi rỗng (không phải null — XML-RPC không mã hoá được None).
    tuNgay: tr.df ? String(tr.df) : '',
    denNgay: tr.dt ? String(tr.dt) : '',
    ky: String(tr.preset ?? ky),
  };
}

export const baoCaoTongQuanDefinition: ToolDefinition = {
  name: 'bao_cao_tong_quan',
  description:
    'Báo cáo tổng quan tình hình kinh doanh: doanh thu, số hoá đơn, trả hàng, ' +
    'so sánh với kỳ trước, top sản phẩm bán chạy, top khách hàng, top nhân viên. ' +
    'GỌI KHI sếp hoặc nhân viên hỏi: "tháng này thế nào", "doanh thu bao nhiêu", ' +
    '"tình hình kinh doanh", "hàng nào bán chạy nhất", "khách nào mua nhiều nhất", ' +
    '"so với tháng trước". ' +
    'Số liệu lấy thẳng từ Odoo — GIỐNG HỆT màn hình dashboard, không tự tính. ' +
    'Cần bảng chi tiết theo ngày/nhân viên/chi nhánh thì dùng bao_cao_ban_hang.',
  inputSchema: {
    type: 'object',
    properties: {
      ky: {
        type: 'string',
        enum: [...KY_HOP_LE],
        description:
          'Kỳ báo cáo. today=hôm nay · yesterday=hôm qua · last_7_days=7 ngày qua · ' +
          'this_month=tháng này (mặc định) · last_month=tháng trước.',
      },
    },
    required: [],
  },
};

/** VND không có phần thập phân (decimal precision = 0 trong Odoo). */
function tien(n: number): string {
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}

/** dd/mm/yyyy từ chuỗi ISO. Rỗng thì trả rỗng, không bịa. */
function ngay(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/**
 * Định dạng cho LLM.
 *
 * Luôn kèm NGUỒN + KỲ: hệ này từng có lỗi "2 màn hình ra 2 số", nên khi sếp
 * thấy số lạ phải đối chiếu được ngay với dashboard.
 */
export function dinhDangBaoCaoTongQuan(b: BaoCaoTongQuan): string {
  const k = b.kpi;

  // Không có hoá đơn nào KHÁC với lỗi — nói rõ, đừng để model tưởng mất dữ liệu.
  if (k.soHoaDon === 0 && k.doanhThu === 0) {
    return `Kỳ ${ngay(b.tuNgay)}–${ngay(b.denNgay)} chưa có hoá đơn nào.\nNguồn: Báo cáo tổng quan (Odoo)`;
  }

  const dong: string[] = [
    `Doanh thu: ${tien(k.doanhThu)} · ${k.soHoaDon} hoá đơn`,
  ];

  // delta_prev = 0 có thể là "bằng đúng kỳ trước" HOẶC "không có kỳ trước để so".
  // Chỉ nói khi có số kỳ trước thật, tránh bịa "tăng 0%".
  if (k.doanhThuKyTruoc > 0) {
    const huong = k.soVoiKyTruoc >= 0 ? 'tăng' : 'giảm';
    dong.push(
      `So kỳ trước: ${huong} ${Math.abs(k.soVoiKyTruoc).toFixed(1)}% ` +
      `(kỳ trước ${tien(k.doanhThuKyTruoc)})`,
    );
  }

  if (k.soPhieuTra > 0) {
    dong.push(`Trả hàng: ${k.soPhieuTra} phiếu · ${tien(k.tienTraHang)}`);
  }

  const themTop = (nhan: string, ds: DongTop[]) => {
    if (ds.length === 0) return;
    dong.push(`\n${nhan}:`);
    for (const t of ds) dong.push(`- ${t.ten}: ${tien(t.giaTri)}`);
  };
  themTop('Top sản phẩm', b.topSanPham);
  themTop('Top khách hàng', b.topKhachHang);

  dong.push(
    `\nNguồn: Báo cáo tổng quan (Odoo) · Kỳ: ${ngay(b.tuNgay)}–${ngay(b.denNgay)}`,
  );
  return dong.join('\n');
}
