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

// ─────────────────────────────────────────────────────────────────────────
// CHẾ ĐỘ THỨ HAI — "tồn dưới N cái" (thêm 11/08/2026)
//
// VÌ SAO THÊM: đo prod 04→11/08 (486 lượt gọi tool) thấy tool này chỉ được gọi
// ĐÚNG 1 LẦN, còn 14 câu hỏi tồn kho khác bị bot mò bằng `doc_odoo`. Ca thật
// 15:38 ngày 11/08 (nhóm Test-AI) — chị Minh Anh: "xem cho chị những hàng nào
// có tồn kho nhỏ hơn 100 nhé", bot đáp "em không có công cụ để tra số tồn kho
// theo điều kiện như vậy ạ". Anh Quyết nhắn anh Quốc: "cho tiểu Mã thêm kiểm
// kho nữa nhé".
//
// Bot từ chối là ĐÚNG với tool lúc đó: `get_low_stock_data` chỉ biết "sắp hết
// trong N NGÀY" (tồn ÷ tốc độ bán). "Tồn < 100 CÁI" là câu hỏi KHÁC hẳn — một
// SP tồn 90 mà không ai mua thì nằm ngoài danh sách sắp hết, nhưng vẫn phải
// hiện khi kiểm kho. Đây là thiếu NĂNG LỰC, không phải thiếu mô tả.
//
// VÌ SAO LỌC Ở DOMAIN ODOO chứ không kéo hết về rồi filter ở TypeScript:
// catalog 1.257 SP — kéo hết là chậm, mà kéo kèm `limit` rồi lọc sau thì lọc
// trên tập đã bị cắt, ra thiếu hàng mà không ai biết.
import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';

/** Số dòng tối đa gửi cho LLM. Tin Zalo dài hơn 10 dòng không ai đọc. */
const TOI_DA_HIEN = 10;

/** Trần `limit` truyền xuống Odoo — lấy dư để biết còn bao nhiêu SP nữa. */
const TRAN_LAY = 30;

/**
 * Trần khi lọc theo ngưỡng tồn. Cao hơn TRAN_LAY vì "tồn < 100" trên catalog
 * 1.257 SP có thể khớp hàng trăm dòng — cần đếm đúng để báo "còn N SP nữa",
 * nếu không nhân viên tưởng chỉ có 10 SP dưới ngưỡng.
 */
const TRAN_LAY_NGUONG = 200;

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
export type DanhSachSapHet = SanPhamSapHet[] & {
  tongKhop?: number;
  /** Ngưỡng tồn đã lọc — có thì `dinhDang` đổi sang lời văn "kiểm kho". */
  nguongTon?: number;
};

export interface CanhBaoTonKhoDeps {
  odoo: Pick<OdooClient, 'execute'> & Partial<Pick<OdooClient, 'searchRead'>>;
}

/** Field đọc khi kiểm kho theo ngưỡng. KHÔNG có standard_price — cấm lộ giá vốn. */
const FIELD_KIEM_KHO = ['id', 'name', 'default_code', 'qty_available'];

/**
 * Kiểm kho: liệt kê SP có tồn DƯỚI một con số cụ thể.
 *
 * Tách hàm riêng vì đây là câu hỏi khác hẳn "sắp hết": không dính tốc độ bán,
 * nguồn số cũng khác (`qty_available` của product.product, không phải method
 * dashboard). Gộp vào một hàm sẽ đẻ ra hai nhánh không liên quan gì nhau.
 */
async function tonDuoiNguong(
  deps: CanhBaoTonKhoDeps,
  nguong: number,
): Promise<DanhSachSapHet> {
  // searchRead là bắt buộc cho chế độ này. Thiếu (client cũ) thì trả rỗng còn
  // hơn im lặng rơi về danh sách "sắp hết" — trả lời câu khác mà không ai biết.
  if (!deps.odoo.searchRead) {
    const rong = [] as DanhSachSapHet;
    rong.tongKhop = 0;
    rong.nguongTon = nguong;
    return rong;
  }

  const rows = await deps.odoo.searchRead<Record<string, unknown>>(
    'product.product',
    [
      ['qty_available', '<', nguong],
      // Chỉ hàng LƯU KHO: dịch vụ/hàng tiêu hao luôn có qty_available = 0 nên
      // sẽ chiếm hết danh sách, đẩy hàng thật cần nhập xuống dưới.
      ['type', '=', 'product'],
      ['active', '=', true],
    ],
    FIELD_KIEM_KHO,
    { limit: TRAN_LAY_NGUONG, order: 'qty_available asc' },
  );

  const tatCa: SanPhamSapHet[] = (Array.isArray(rows) ? rows : []).map((r) => ({
    sanPhamId: Number(r.id ?? 0),
    ten: String(r.name ?? ''),
    ma: String(r.default_code ?? ''),
    ton: Number(r.qty_available ?? 0),
    // Chế độ này KHÔNG biết tốc độ bán — để 0 chứ không bịa, và `dinhDang`
    // không in mấy số này ra.
    bqNgay: 0,
    soNgayCon: 0,
    mucDo: 'warning',
  }));

  // Tồn thấp nhất lên đầu — hàng sắp cạn là thứ cần nhìn trước.
  tatCa.sort((a, b) => a.ton - b.ton);

  const hienThi = tatCa.slice(0, TOI_DA_HIEN) as DanhSachSapHet;
  hienThi.tongKhop = tatCa.length;
  hienThi.nguongTon = nguong;
  return hienThi;
}

export async function canhBaoTonKho(
  deps: CanhBaoTonKhoDeps,
  input: { so_ngay?: number; ton_duoi?: number } = {},
): Promise<DanhSachSapHet> {
  // Nhân viên nói ngưỡng TỒN → đi đường kiểm kho. Ngưỡng phải > 0: "tồn dưới
  // 0" không có nghĩa, và số rác (âm/0/NaN) mà rơi im lặng sang chế độ "sắp
  // hết" thì bot trả lời câu khác câu được hỏi.
  const nguong = Number(input.ton_duoi);
  if (input.ton_duoi != null && Number.isFinite(nguong) && nguong > 0) {
    return tonDuoiNguong(deps, nguong);
  }
  if (input.ton_duoi != null) {
    const rong = [] as DanhSachSapHet;
    rong.tongKhop = 0;
    rong.nguongTon = Number.isFinite(nguong) ? nguong : 0;
    return rong;
  }
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

// VÌ SAO MÔ TẢ DÀI VÀ CÓ VÍ DỤ NGUYÊN VĂN: model chọn tool bằng MÔ TẢ, không
// bằng code. Mô tả cũ chỉ nói "sắp hết hàng" nên câu "tồn kho nhỏ hơn 100" đọc
// vào không thấy khớp — kết quả đo prod 8 ngày: tool này 1 lần, `doc_odoo` 14
// lần cho cùng nghiệp vụ, và một lần bot từ chối thẳng (15:38 11/08). Câu hỏi
// thật được chép nguyên văn vào đây vì đó là cách rẻ nhất để model khớp đúng.
export const canhBaoTonKhoDefinition: ToolDefinition = {
  name: 'canh_bao_ton_kho',
  description:
    'Tra tồn kho theo ĐIỀU KIỆN trên TOÀN BỘ sản phẩm — hai chế độ. ' +
    '(1) KIỂM KHO theo ngưỡng: truyền ton_duoi để liệt kê mọi SP có tồn nhỏ hơn ' +
    'một con số. GỌI KHI hỏi: "những hàng nào có tồn kho nhỏ hơn 100", ' +
    '"hàng nào tồn dưới 50", "kiểm kho xem cái nào sắp cạn", "SP nào còn ít hàng". ' +
    '(2) SẮP HẾT theo tốc độ bán: truyền so_ngay (hoặc để trống) để liệt kê SP sẽ ' +
    'hết trong N ngày tới, tính bằng tồn chia tốc độ bán 30 ngày qua. GỌI KHI hỏi: ' +
    '"sản phẩm nào sắp hết", "cần nhập hàng gì", "hàng nào bán nhanh mà sắp cạn". ' +
    'ĐÂY LÀ TOOL DUY NHẤT trả lời được câu hỏi tồn kho có ĐIỀU KIỆN. ' +
    'KHÔNG dùng doc_odoo để mò tồn kho, và KHÔNG dùng tra_ton_kho: tool đó chỉ tra ' +
    'ĐÚNG MỘT sản phẩm đã biết id, không lọc được theo điều kiện trên cả kho.',
  inputSchema: {
    type: 'object',
    properties: {
      ton_duoi: {
        type: 'integer',
        description:
          'CHẾ ĐỘ KIỂM KHO: liệt kê SP có tồn nhỏ hơn con số này. ' +
          'Câu "hàng nào tồn kho nhỏ hơn 100" → ton_duoi=100. ' +
          'Chỉ dùng khi nhân viên nêu một CON SỐ TỒN cụ thể.',
      },
      so_ngay: {
        type: 'integer',
        description:
          'CHẾ ĐỘ SẮP HẾT: liệt kê SP sẽ hết trong bao nhiêu ngày tới. ' +
          'Mặc định 14, tối đa 90. Bỏ trống khi dùng ton_duoi.',
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
  const nguong = list.nguongTon;

  // ── Chế độ KIỂM KHO ("tồn dưới N") ────────────────────────────────────
  //
  // Lời văn RIÊNG chứ không dùng chung với "sắp hết": chế độ này không biết
  // tốc độ bán, in ra "hết sau ~0 ngày" là bịa số cho mọi dòng.
  if (nguong != null) {
    if (list.length === 0) {
      return (
        `Không có sản phẩm nào tồn dưới ${so(nguong)} — kho đang đủ hàng ở ngưỡng này.\n` +
        'Nguồn: Kiểm kho (Odoo · tồn hiện tại)'
      );
    }

    const dong = list
      .map((s) => `- ${s.ten}${s.ma ? ` [${s.ma}]` : ''}: còn ${so(s.ton)}`)
      .join('\n');
    // Cắt IM LẶNG là lỗi nguy hiểm nhất — xem chú thích ở nhánh dưới.
    const conNua =
      tong > list.length
        ? `\nCÒN ${tong - list.length} SP nữa — đây là ${list.length} SP tồn thấp nhất.`
        : '';

    return (
      `${tong} sản phẩm có tồn dưới ${so(nguong)}:\n${dong}${conNua}\n` +
      'Nguồn: Kiểm kho (Odoo · tồn hiện tại)'
    );
  }

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
