// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: báo cáo bán hàng chi tiết (4 tab: thời gian / lợi nhuận / nhân viên / chi nhánh).
//
// KHÁC bao_cao_tong_quan: tool kia trả KPI tóm tắt, tool này trả BẢNG theo
// chiều cụ thể ("nhân viên nào bán nhiều nhất", "chi nhánh nào doanh thu cao").
//
// LUẬT CỨNG — KHÔNG TỰ TÍNH TỔNG: chỉ đọc `totals_row` mà Odoo trả về, tuyệt
// đối không .reduce() cộng các dòng lại. Xem giải thích đầy đủ ở
// bao-cao-tong-quan.ts.
//
// CẠM BẪY ĐÃ GẶP THẬT: `time_preset='custom'` mà thiếu date_from/date_to thì
// Odoo trả rows RỖNG và totals=false, KHÔNG báo lỗi. Để nguyên vậy thì bot nói
// "doanh thu 0đ" — sai nguy hiểm hơn báo lỗi. Tool tự chặn ở dưới.

import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';
import { thamSoLocDashboard, type BoLocDashboard } from './bao-cao-tong-quan.js';
import { KY_HOP_LE as KY_BOT, MO_TA_TU_NGAY, MO_TA_DEN_NGAY } from '../ky-thoi-gian.js';

/** Số dòng tối đa mỗi bảng. Kết quả tool nằm lại trong lịch sử và bị tính tiền
 *  lại ở MỌI vòng sau — bảng 30 dòng ăn hết ngân sách ngữ cảnh. */
const DONG_TOI_DA = 10;

/**
 * Cột chứa GIÁ VỐN — xoá trước khi đưa cho LLM.
 *
 * Tab `by_profit` có cột `cost` (giá vốn) và `profit`. Odoo đã chặn ở tầng field
 * bằng `groups="incokit_pos.group_manager"`, nhưng đây là hàng rào thứ hai:
 * nếu user bot lỡ được cấp group_manager, code vẫn không lộ giá vốn.
 *
 * `profit`/`pct` GIỮ LẠI: lãi là con số lãnh đạo cần, và biết lãi không suy
 * ngược ra giá vốn từng mặt hàng (đây là tổng theo hoá đơn).
 */
const COT_CAM = ['cost'] as const;

export const KY_HOP_LE = [
  'today', 'yesterday', 'last_7_days', 'this_month', 'last_month',
] as const;
export type KyBaoCao = (typeof KY_HOP_LE)[number];

/** Tên tab Odoo → nhãn tiếng Việt cho model đọc. */
export const NHAN_TAB: Record<string, string> = {
  by_time: 'Theo thời gian',
  by_profit: 'Lợi nhuận',
  by_staff: 'Theo nhân viên',
  by_branch: 'Theo chi nhánh',
};

export interface CotBaoCao {
  key: string;
  label: string;
  type: 'text' | 'int' | 'money' | 'percent' | string;
}

export interface TabBaoCao {
  key: string;
  nhan: string;
  cot: CotBaoCao[];
  dong: Record<string, unknown>[];
  /** Dòng tổng do Odoo tính. `null` khi tab rỗng. */
  tong: Record<string, unknown> | null;
  /** Tổng số dòng trước khi cắt — để báo "còn nữa". */
  tongSoDong: number;
}

export interface KetQuaBanHang {
  tabs: TabBaoCao[];
  tuNgay: string;
  denNgay: string;
  ky: string;
  /** false = user không đủ quyền xem lợi nhuận (tab by_profit vắng mặt). */
  coTabLoiNhuan: boolean;
}

export interface BaoCaoBanHangDeps {
  odoo: Pick<OdooClient, 'execute'>;
}

/** Xoá cột cấm khỏi cả metadata cột lẫn từng dòng dữ liệu. */
function locCotCam(
  cot: CotBaoCao[],
  dong: Record<string, unknown>[],
): { cot: CotBaoCao[]; dong: Record<string, unknown>[] } {
  const cam = new Set<string>(COT_CAM);
  return {
    cot: cot.filter((c) => !cam.has(c.key)),
    dong: dong.map((d) => {
      const s = { ...d };
      for (const k of cam) delete s[k];
      return s;
    }),
  };
}

export async function baoCaoBanHang(
  deps: BaoCaoBanHangDeps,
  input: BoLocDashboard & { tab?: string; bayGio?: Date } = {},
): Promise<KetQuaBanHang> {
  // Kỳ + chi nhánh dùng chung bộ lọc với bao_cao_tong_quan (25/08). custom
  // LUÔN kèm đủ date_from/date_to (ky-odoo.ts) nên không còn ca "rows rỗng
  // không báo lỗi" của custom-thiếu-ngày.
  const boLoc = thamSoLocDashboard(input, input.bayGio);
  const ky = String(boLoc.kwargs.time_preset) + boLoc.moTaKy;

  // args = [] (KHÔNG [[]]) — @api.model, Odoo tự chèn recordset.
  const r = await deps.odoo.execute<Record<string, unknown>>(
    'incokit.sales_report',
    'get_sales_report_data',
    [],
    boLoc.kwargs,
  );

  const tabsRaw = Array.isArray(r?.tabs) ? (r.tabs as Record<string, unknown>[]) : [];
  const loc = input.tab?.trim();

  const tabs: TabBaoCao[] = tabsRaw
    .filter((t) => !loc || String(t.key) === loc)
    .map((t) => {
      const cotRaw = (Array.isArray(t.columns) ? t.columns : []) as CotBaoCao[];
      const dongRaw = (Array.isArray(t.rows) ? t.rows : []) as Record<string, unknown>[];
      const sach = locCotCam(cotRaw, dongRaw);

      // totals_row là false khi tab rỗng (Odoo dùng false thay None vì
      // XML-RPC không mã hoá được None).
      const tongRaw = t.totals_row;
      const tong =
        tongRaw && typeof tongRaw === 'object'
          ? locCotCam(sach.cot, [tongRaw as Record<string, unknown>]).dong[0]
          : null;

      return {
        key: String(t.key ?? ''),
        nhan: NHAN_TAB[String(t.key ?? '')] ?? String(t.label ?? t.key ?? ''),
        cot: sach.cot,
        dong: sach.dong.slice(0, DONG_TOI_DA),
        tong,
        tongSoDong: dongRaw.length,
      };
    });

  const tr = (r?.time_range ?? {}) as Record<string, unknown>;
  return {
    tabs,
    tuNgay: tr.df ? String(tr.df) : '',
    denNgay: tr.dt ? String(tr.dt) : '',
    ky: String(tr.preset ?? ky),
    coTabLoiNhuan: tabsRaw.some((t) => String(t.key) === 'by_profit'),
  };
}

export const baoCaoBanHangDefinition: ToolDefinition = {
  name: 'bao_cao_ban_hang',
  description:
    'Báo cáo bán hàng dạng BẢNG theo 4 chiều: theo thời gian, theo lợi nhuận, ' +
    'theo nhân viên, theo chi nhánh. ' +
    'GỌI KHI hỏi câu cần chi tiết theo chiều cụ thể: "nhân viên nào bán nhiều nhất", ' +
    '"chi nhánh nào doanh thu cao nhất", "doanh thu từng ngày tháng này", ' +
    '"lãi bao nhiêu", "báo cáo bán hàng". ' +
    'Chỉ cần con số tổng quát (doanh thu, top SP, so kỳ trước) thì dùng ' +
    'bao_cao_tong_quan — nhẹ hơn. ' +
    'Số liệu lấy thẳng từ Odoo, GIỐNG HỆT màn hình báo cáo.',
  inputSchema: {
    type: 'object',
    properties: {
      ky: {
        type: 'string',
        enum: [...KY_HOP_LE, ...KY_BOT.filter((k) => !['hom_nay', 'hom_qua', 'thang_nay', 'thang_truoc'].includes(k))],
        description:
          'Kỳ báo cáo. today · yesterday · last_7_days · this_month (mặc định) · last_month · ' +
          'tuan_nay · quy_nay · nam_nay · 3_thang_qua/6_thang_qua/12_thang_qua. ' +
          'Bạn KHÔNG biết hôm nay là ngày nào — hệ thống tự tính, ĐỪNG nhẩm ngày.',
      },
      tu_ngay: { type: 'string', description: MO_TA_TU_NGAY },
      den_ngay: { type: 'string', description: MO_TA_DEN_NGAY },
      chi_nhanh: {
        type: 'string',
        enum: ['TT', 'HCM', 'KB'],
        description: 'Lọc theo CHI NHÁNH khi nhân viên nêu (HCM / TT=trung tâm / KB=kho B). Không nhắc thì bỏ trống.',
      },
      tab: {
        type: 'string',
        enum: ['by_time', 'by_profit', 'by_staff', 'by_branch'],
        description:
          'Chỉ lấy MỘT bảng cho gọn. by_time=theo thời gian · by_profit=lợi nhuận · ' +
          'by_staff=theo nhân viên · by_branch=theo chi nhánh. ' +
          'Bỏ trống để lấy tất cả — nhưng nếu câu hỏi rõ ràng về một chiều thì NÊN ' +
          'truyền tab để tiết kiệm.',
      },
    },
    required: [],
  },
};

/** VND không thập phân. */
function tien(n: number): string {
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}

function ngay(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** Định dạng một ô theo kiểu cột. */
function o(v: unknown, kieu: string): string {
  if (v === null || v === undefined || v === '' || v === false) return '';
  if (kieu === 'money') return tien(Number(v));
  if (kieu === 'int') return Math.round(Number(v)).toLocaleString('vi-VN');
  if (kieu === 'percent') return `${Number(v).toFixed(1)}%`;
  return String(v);
}

/**
 * Định dạng cho LLM.
 *
 * Ưu tiên DÒNG TỔNG — đó là số lãnh đạo cần. Các dòng chi tiết chỉ để tham
 * khảo và bị cắt còn 10.
 */
export function dinhDangBaoCaoBanHang(kq: KetQuaBanHang): string {
  if (kq.tabs.length === 0) {
    return (
      'Không lấy được báo cáo bán hàng cho kỳ này. Hãy thử kỳ khác ' +
      '(this_month, last_month) hoặc báo nhân viên kiểm tra Odoo.'
    );
  }

  const phan: string[] = [];

  for (const t of kq.tabs) {
    if (t.dong.length === 0) {
      phan.push(`## ${t.nhan}: không có dữ liệu trong kỳ này.`);
      continue;
    }

    const khoiDong = t.dong
      .map((d) =>
        t.cot
          .map((c) => o(d[c.key], c.type))
          .filter((x) => x !== '')
          .join(' · '),
      )
      .join('\n');

    // Dòng TỔNG là thứ quan trọng nhất — đặt ngay sau tiêu đề để model không
    // bỏ sót khi tóm tắt.
    const dongTong = t.tong
      ? `TỔNG: ${t.cot.map((c) => (t.tong?.[c.key] !== undefined && t.tong[c.key] !== '' ? `${c.label} ${o(t.tong[c.key], c.type)}` : '')).filter(Boolean).join(' · ')}`
      : '';

    // Cắt IM LẶNG là lỗi nguy hiểm nhất — model không biết mình thiếu dữ liệu.
    const conNua =
      t.tongSoDong > t.dong.length
        ? `\n(hiển thị ${t.dong.length}/${t.tongSoDong} dòng)`
        : '';

    phan.push(`## ${t.nhan}\n${dongTong}\n${khoiDong}${conNua}`);
  }

  // Vắng tab lợi nhuận = user không đủ quyền. Nói rõ để model KHÔNG đoán số.
  const ghiChuQuyen = kq.coTabLoiNhuan
    ? ''
    : '\nLƯU Ý: tài khoản hiện tại không có quyền xem lợi nhuận. ' +
      'KHÔNG được đoán hay tự tính lãi — nói rõ là không có quyền.';

  return (
    `${phan.join('\n\n')}${ghiChuQuyen}\n\n` +
    `Nguồn: Báo cáo bán hàng (Odoo) · Kỳ: ${ngay(kq.tuNgay)}–${ngay(kq.denNgay)}`
  );
}
