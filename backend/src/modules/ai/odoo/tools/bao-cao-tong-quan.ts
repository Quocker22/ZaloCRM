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
import { thamSoKyOdoo } from '../ky-odoo.js';
import { KY_HOP_LE as KY_BOT, MO_TA_TU_NGAY, MO_TA_DEN_NGAY } from '../ky-thoi-gian.js';
import { KHO } from '../../agent/noi-zalo/gom-don/kieu.js';

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
  /** Doanh thu theo ngày/giờ trong kỳ — Odoo trả sẵn (revenue_chart), để vẽ cột. */
  bieuDoDoanhThu: DongTop[];
  /** Doanh thu theo chi nhánh (branch_chart). */
  bieuDoChiNhanh: DongTop[];
  /** Mã chi nhánh đã lọc (TT/HCM/KB) — undefined = tất cả. */
  chiNhanh?: string;
  topTheo: 'doanh_thu' | 'so_don' | 'so_luong';
}

/** Bộ lọc chung của hai tool dashboard — khớp bộ lọc trên web (25/08). */
export interface BoLocDashboard {
  ky?: string;
  tu_ngay?: string;
  den_ngay?: string;
  /** TT | HCM | KB — map cứng sang warehouse id qua bảng KHO, không tin số model. */
  chi_nhanh?: string;
}

/** Preset Odoo giữ nguyên; từ khoá bot (quy_nay, 6_thang_qua…) hay ngày → custom. */
export function thamSoLocDashboard(
  input: BoLocDashboard,
  bayGio: Date = new Date(),
): { kwargs: Record<string, unknown>; moTaKy: string; chiNhanh?: string } {
  const kwargs: Record<string, unknown> = {};
  let moTaKy = '';
  const kyOdoo = (KY_HOP_LE as readonly string[]).includes(input.ky ?? '');
  if (kyOdoo && !input.tu_ngay && !input.den_ngay) {
    kwargs.time_preset = input.ky;
  } else if ((KY_BOT as readonly string[]).includes(input.ky ?? '') || input.tu_ngay || input.den_ngay) {
    const p = thamSoKyOdoo({ ky: input.ky, tu_ngay: input.tu_ngay, den_ngay: input.den_ngay }, bayGio);
    kwargs.time_preset = p.time_preset;
    if (p.date_from) kwargs.date_from = p.date_from;
    if (p.date_to) kwargs.date_to = p.date_to;
    moTaKy = p.ky.canhBao ? ` ⚠ ${p.ky.canhBao}` : '';
  } else {
    kwargs.time_preset = 'this_month';
  }
  const maKho = (input.chi_nhanh ?? '').trim().toUpperCase();
  const kho = KHO.find((k) => k.ma === maKho);
  if (kho) kwargs.warehouse_ids = [kho.id];
  return { kwargs, moTaKy, ...(kho ? { chiNhanh: kho.ma } : {}) };
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
function docTop(v: unknown, toiDa = TOP_TOI_DA): DongTop[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, toiDa).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return { ten: String(o.label ?? ''), giaTri: Number(o.value ?? 0) };
  });
}

export async function baoCaoTongQuan(
  deps: BaoCaoTongQuanDeps,
  input: BoLocDashboard & { top_theo?: string; bayGio?: Date } = {},
): Promise<BaoCaoTongQuan> {
  // Preset lạ → this_month; từ khoá bot / ngày cụ thể → custom (ky-odoo.ts).
  // KHÔNG truyền thẳng chuỗi của model xuống Odoo: preset không nhận ra thì
  // Odoo lặng lẽ trả kỳ khác, bot báo số của kỳ sai mà không ai biết.
  const loc = thamSoLocDashboard(input, input.bayGio);
  const topTheo = (['doanh_thu', 'so_don', 'so_luong'] as const).find((t) => t === input.top_theo) ?? 'doanh_thu';
  // Khớp bộ lọc web: top KH/NV theo doanh thu hay số đơn; top SP theo doanh
  // thu hay số lượng. Chỉ gửi khi NV chọn khác mặc định — kwargs mặc định giữ
  // nguyên {time_preset} như trước.
  const kwargs: Record<string, unknown> = { ...loc.kwargs };
  if (topTheo === 'so_don') { kwargs.top_customer_by = 'orders'; kwargs.top_staff_by = 'orders'; }
  if (topTheo === 'so_luong') kwargs.top_product_by = 'quantity';
  // Kỳ một ngày → cột theo GIỜ mới có gì để nhìn; còn lại theo ngày như web.
  if (kwargs.time_preset === 'today' || kwargs.time_preset === 'yesterday') kwargs.chart_granularity = 'hour';

  // args = [] (KHÔNG [[]]) — xem giải thích ở canh-bao-ton-kho.ts.
  const r = await deps.odoo.execute<Record<string, unknown>>(
    'incokit.dashboard_overview',
    'get_dashboard_data',
    [],
    kwargs,
  );
  const ky = String(kwargs.time_preset);

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
    ky: String(tr.preset ?? ky) + loc.moTaKy,
    // Biểu đồ Odoo trả sẵn (25/08) — KHÔNG cắt TOP_TOI_DA, cột nào cũng phải có.
    bieuDoDoanhThu: docTop(sach.revenue_chart, 400),
    bieuDoChiNhanh: docTop(sach.branch_chart, 50),
    ...(loc.chiNhanh ? { chiNhanh: loc.chiNhanh } : {}),
    topTheo,
  };
}

export const baoCaoTongQuanDefinition: ToolDefinition = {
  name: 'bao_cao_tong_quan',
  description:
    'Báo cáo tổng quan tình hình kinh doanh: doanh thu, số hoá đơn, trả hàng, ' +
    'so sánh với kỳ trước, kèm vài dòng top sản phẩm/khách/nhân viên. ' +
    'GỌI KHI hỏi BỨC TRANH CHUNG: "tháng này thế nào", "doanh thu bao nhiêu", ' +
    '"tình hình kinh doanh", "so với tháng trước". ' +
    'Số liệu lấy thẳng từ Odoo — GIỐNG HỆT màn hình dashboard, không tự tính. ' +
    // 06/08/2026: nhường hẳn "bán chạy" cho top_san_pham — đo thật flash-lite
    // chọn nhầm tool này cho câu "sản phẩm nào bán chạy nhất?".
    'Hỏi RIÊNG top sản phẩm bán chạy/hàng ế → dùng top_san_pham. ' +
    'Cần bảng chi tiết theo ngày/nhân viên/chi nhánh thì dùng bao_cao_ban_hang.',
  inputSchema: {
    type: 'object',
    properties: {
      ky: {
        type: 'string',
        enum: [...KY_HOP_LE, ...KY_BOT.filter((k) => !['hom_nay', 'hom_qua', 'thang_nay', 'thang_truoc'].includes(k))],
        description:
          'Kỳ báo cáo. today=hôm nay · yesterday=hôm qua · last_7_days=7 ngày qua · ' +
          'this_month=tháng này (mặc định) · last_month=tháng trước · tuan_nay=tuần này · ' +
          'quy_nay=quý này · nam_nay=năm nay · 3_thang_qua/6_thang_qua/12_thang_qua. ' +
          'Bạn KHÔNG biết hôm nay là ngày nào — hệ thống tự tính, ĐỪNG nhẩm ngày.',
      },
      tu_ngay: { type: 'string', description: MO_TA_TU_NGAY },
      den_ngay: { type: 'string', description: MO_TA_DEN_NGAY },
      chi_nhanh: {
        type: 'string',
        enum: ['TT', 'HCM', 'KB'],
        description:
          'Lọc theo CHI NHÁNH khi nhân viên nêu: "chi nhánh HCM"/"kho Hồ Chí Minh" → HCM; ' +
          '"trung tâm"/"kho TT" → TT; "kho B" → KB. Không nhắc thì BỎ TRỐNG (= tất cả).',
      },
      top_theo: {
        type: 'string',
        enum: ['doanh_thu', 'so_don', 'so_luong'],
        description:
          'Xếp top theo gì: doanh_thu (mặc định) · so_don ("khách nào mua nhiều đơn nhất", ' +
          '"nhân viên nào bán nhiều đơn") · so_luong ("sản phẩm nào bán nhiều cái nhất").',
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
