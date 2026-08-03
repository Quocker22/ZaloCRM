// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: cảnh báo sản phẩm sắp hết hàng.
//
// VÌ SAO TOOL NÀY TỒN TẠI: logic cảnh báo đã có và đã chạy đúng trên dashboard
// Odoo từ lâu, nhưng `_build_low_stock_html()` trả về CHUỖI HTML — không gửi
// được qua Zalo. Method `get_low_stock_data()` (thêm 2026-07-30) trả cùng số
// liệu ở dạng dữ liệu; tool này chỉ bọc lại.
//
// KHÔNG TỰ TÍNH: mọi ngưỡng lọc nhiễu (bán ít nhất 3 ngày khác nhau, loại
// tax-line, chỉ tính kho internal) nằm trong SQL phía Odoo và đã trả giá bằng
// bug thật mới có. Tính lại ở TypeScript là tạo nguồn sự thật thứ hai.

import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';

/** Số dòng tối đa gửi cho LLM. Tin Zalo dài hơn 10 dòng không ai đọc. */
const TOI_DA_HIEN = 10;

/** Trần `limit` truyền xuống Odoo — lấy dư để biết còn bao nhiêu SP nữa. */
const TRAN_LAY = 30;

export interface SanPhamSapHet {
  sanPhamId: number;
  ten: string;
  ma: string;
  ton: number;
  bqNgay: number;
  soNgayCon: number;
  mucDo: 'danger' | 'warning';
}

/** Mảng kết quả kèm tổng số khớp — để biết có bị cắt hay không. */
export type DanhSachSapHet = SanPhamSapHet[] & { tongKhop?: number };

export interface CanhBaoTonKhoDeps {
  odoo: Pick<OdooClient, 'execute'>;
}

export async function canhBaoTonKho(
  deps: CanhBaoTonKhoDeps,
  input: { so_ngay?: number } = {},
): Promise<DanhSachSapHet> {
  // Odoo mặc định 14 ngày. Cho phép hỏi "sắp hết trong 7 ngày" nhưng chặn số
  // vô lý: 0 thì không ra gì, 365 thì gần như cả catalog.
  const soNgay = Math.min(Math.max(1, input.so_ngay ?? 14), 90);

  // args = [] (KHÔNG phải [[]]): method là @api.model nên Odoo tự chèn recordset.
  // Truyền [[]] sẽ đẩy một [] thừa vào tham số vị trí đầu → "got multiple values".
  // Mọi tham số đặt tên trong kwargs, miễn nhiễm khi Odoo đổi thứ tự chữ ký.
  const rows = await deps.odoo.execute<Record<string, unknown>[]>(
    'incokit.dashboard_overview',
    'get_low_stock_data',
    [],
    { days_ahead: soNgay, limit: TRAN_LAY },
  );

  const tatCa: SanPhamSapHet[] = (Array.isArray(rows) ? rows : []).map((r) => ({
    sanPhamId: Number(r.product_id ?? 0),
    ten: String(r.ten ?? ''),
    ma: String(r.ma ?? ''),
    ton: Number(r.ton ?? 0),
    bqNgay: Number(r.bq_ngay ?? 0),
    soNgayCon: Number(r.so_ngay_con ?? 0),
    mucDo: r.muc_do === 'danger' ? 'danger' : 'warning',
  }));

  // Odoo đã ORDER BY days_left ASC, nhưng sắp lại cho chắc: hàng gấp nhất lên
  // đầu là điều DUY NHẤT quan trọng khi danh sách bị cắt còn 10 dòng.
  tatCa.sort((a, b) => a.soNgayCon - b.soNgayCon);

  const hienThi = tatCa.slice(0, TOI_DA_HIEN) as DanhSachSapHet;
  hienThi.tongKhop = tatCa.length;
  return hienThi;
}

export const canhBaoTonKhoDefinition: ToolDefinition = {
  name: 'canh_bao_ton_kho',
  description:
    'Danh sách sản phẩm SẮP HẾT HÀNG — tính theo tồn hiện tại chia cho tốc độ bán ' +
    'trung bình 30 ngày qua. GỌI KHI nhân viên hoặc sếp hỏi: "sản phẩm nào sắp hết", ' +
    '"cần nhập hàng gì", "hàng nào bán nhanh mà sắp cạn", "cảnh báo tồn kho". ' +
    'Đây là nguồn DUY NHẤT đúng cho cảnh báo tồn — cùng số liệu với dashboard Odoo. ' +
    'KHÔNG tự suy ra SP sắp hết từ tra_ton_kho: tool đó chỉ cho tồn hiện tại, ' +
    'không biết tốc độ bán.',
  inputSchema: {
    type: 'object',
    properties: {
      so_ngay: {
        type: 'integer',
        description:
          'Ngưỡng cảnh báo: liệt kê SP sẽ hết trong bao nhiêu ngày tới. ' +
          'Mặc định 14, tối đa 90.',
      },
    },
    required: [],
  },
};

/** Định dạng VN: 1.234 (không thập phân — quy ước VND của hệ thống). */
function so(n: number): string {
  return Math.round(n).toLocaleString('vi-VN');
}

/**
 * Định dạng cho LLM đọc.
 *
 * Luôn kèm NGUỒN — hệ này từng có lỗi "2 màn hình ra 2 số", nên mọi con số
 * phải truy ngược được về chỗ đối chiếu.
 */
export function dinhDangCanhBaoTonKho(list: DanhSachSapHet): string {
  const tong = list.tongKhop ?? list.length;

  // Rỗng KHÔNG được trả chuỗi trống: model nhận chuỗi rỗng sẽ tự bịa nội dung.
  if (list.length === 0) {
    return (
      'Không có sản phẩm nào sắp hết trong ngưỡng đang xét — tồn kho đang ổn.\n' +
      'Nguồn: Cảnh báo tồn kho (Odoo)'
    );
  }

  const dong = list
    .map((s) => {
      const gap = s.mucDo === 'danger' ? ' [GẤP]' : '';
      // "< 1 ngày" thay vì "0 ngày" — 0 gây hiểu nhầm là đã hết.
      const conLai = s.soNgayCon < 1 ? 'dưới 1 ngày' : `~${Math.round(s.soNgayCon)} ngày`;
      const ma = s.ma ? ` [${s.ma}]` : '';
      return `- ${s.ten}${ma}: còn ${so(s.ton)}, bán ${so(s.bqNgay)}/ngày → hết sau ${conLai}${gap}`;
    })
    .join('\n');

  const gap = list.filter((s) => s.mucDo === 'danger').length;
  const dauDe = `${tong} sản phẩm sắp hết${gap > 0 ? ` (${gap} mức GẤP — dưới 7 ngày)` : ''}:`;

  // Cắt IM LẶNG là lỗi nguy hiểm nhất: model không có tín hiệu nào để biết
  // mình đang tóm tắt trên dữ liệu thiếu.
  const conNua =
    tong > list.length
      ? `\nCÒN ${tong - list.length} SP nữa — đây là ${list.length} SP gấp nhất.`
      : '';

  return `${dauDe}\n${dong}${conNua}\nNguồn: Cảnh báo tồn kho (Odoo) · dựa trên bán 30 ngày qua`;
}
