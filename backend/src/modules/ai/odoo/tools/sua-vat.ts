// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: THÊM / ĐỔI / BỎ VAT cho một đơn ĐÃ TỒN TẠI.
//
// ═══════════════════════════════════════════════════════════════════════════
// VÌ SAO TỒN TẠI — ca thật hỏng, nhóm Test-AI 20:38→20:41 ngày 11/08/2026
//
//   20:38:02  Bot: "Đã lên đơn nháp S13829 ... tổng 45.000.000đ"
//   20:38:18  NV : "@bot sửa lại thêm VAT 8%"
//   20:38:23  Bot: "...cộng thêm 8% vào tổng (48.600.000đ) đúng không ạ, hay là
//                   anh/chị muốn em sửa giá các dòng hàng...?"
//   20:38:40  NV : "đúng rồi"
//   20:39:47  Bot: hỏi lại y hệt
//   20:40:17  NV : "@bot đúng rồi xuất đi"
//   20:40:27  Bot: "...cộng 8% VAT vào từng dòng hàng (NHÂN GIÁ LÊN 1.08) hay
//                   chỉ cộng vào dòng nào cụ thể ạ?"
//   20:41:00  NV : "@bot cộng thẳng vào đơn nhé"
//   20:41:05  Bot: hỏi vòng thứ TƯ
//
//   Anh Quốc: "hiện tại cái thêm VAT đang không được này hỏi vòng quanh hoài à"
//
// CHẨN ĐOÁN: đơn S13829 ĐÃ LÊN rồi nên máy gom đơn (`gom-don`) không còn cầm
// lái — log không có dòng `nhanh: 'gom-don'` nào cho các câu VAT. Câu rơi vào
// agent tự do. Agent có `sua_chiet_khau` nên chiết khấu làm được NGAY (20:41:56
// "Đã áp chiết khấu 10% cho đơn S13829"), nhưng VAT thì KHÔNG có tool tương
// đương. `sua_don` có nhận `thue_id` nhưng nó là tool sửa DÒNG HÀNG: model phải
// dựng cả danh sách dòng (san_pham_id + so_luong) mới gọi được — nó không biết
// làm nên hỏi vòng quanh 4 lần trong 3 phút.
//
// File này lấp đúng khoảng trống đó: cùng hình dạng `sua_chiet_khau` (nhận mã
// đơn, áp cho mọi dòng, đọc lại số thật), chỉ khác cột ghi.
//
// ═══════════════════════════════════════════════════════════════════════════
// LUẬT XƯƠNG SỐNG: GIÁ LÀ GIÁ, THUẾ LÀ THUẾ.
//
// Model đề nghị "nhân giá lên 1.08" ở 20:40:27 là SAI HOÀN TOÀN. Làm vậy thì:
//   - Odoo ghi price_unit = 237.600đ thay vì 220.000đ → sai giá đã chốt với
//     khách, hoá đơn in ra sai;
//   - `amount_tax` VẪN = 0 → sổ thuế trống, kế toán không khấu trừ được.
// VAT chỉ đi vào `sale.order.line.tax_id` (account.tax), Odoo tự tính
// `amount_tax`. Tool này KHÔNG BAO GIỜ ghi `price_unit` — hàng rào nằm trong
// CODE (vals chỉ có đúng một khoá `tax_id`), không phải trong prompt.
//
// RANH GIỚI (kế thừa nguyên `sua_chiet_khau`):
//   - CHỈ đơn NHÁP (draft/sent). Đơn đã xác nhận đã vào sổ kế toán/tồn kho;
//     đổi thuế là làm lệch số đã chốt. Đơn huỷ thì sửa chẳng để làm gì.
//   - KHÔNG hard-code id thuế: tra động qua `traThueBan()`. id là CẤU HÌNH của
//     Odoo, đổi DB/công ty là id trỏ sang dòng thuế khác — ghi sai mà không
//     cảnh báo. Không tra được mức thuế → BÁO nhân viên, tuyệt đối không im
//     lặng ghi bừa hay bỏ qua.
//   - Số báo về là số Odoo TRẢ VỀ sau khi ghi, không phải phép nhân của mình.
//     Bài học 11/08: tool công nợ tự tính tổng rời khỏi danh sách nên báo
//     3,99tr trong khi thật 144tr.
import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';
import { traThueBan } from './tra-thue.js';

/** Trạng thái đơn CHO PHÉP sửa thuế. Ngoài danh sách này là từ chối. */
const STATE_SUA_DUOC = ['draft', 'sent'] as const;

export interface KetQuaVat {
  ok: boolean;
  donId: number;
  maDon: string;
  /** Lý do từ chối. Chỉ có khi ok=false. */
  lyDo?: string;
  /** true = lệnh BỎ thuế (phan_tram = 0). */
  boThue?: boolean;
  phanTram?: number;
  /** id dòng account.tax đã gắn — tra động, không hằng số. */
  thueId?: number;
  tenThue?: string;
  soDong?: number;
  /** Số ĐỌC LẠI từ Odoo sau khi ghi. */
  tienHang?: number;
  tienThue?: number;
  tongSau?: number;
}

export interface SuaVatDeps {
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
}

/** Các cột tổng tiền cần đọc để báo con số THẬT. */
const COT_TONG = ['id', 'name', 'state', 'amount_untaxed', 'amount_tax', 'amount_total'];

/** Tìm đơn theo id (ưu tiên) hoặc mã. Cùng lối `sua_chiet_khau`. */
async function timDon(
  odoo: SuaVatDeps['odoo'],
  input: { don_id?: number; ma_don?: string },
): Promise<Record<string, unknown> | null> {
  if (input.don_id) {
    const r = await odoo.searchRead<Record<string, unknown>>(
      'sale.order', [['id', '=', input.don_id]], COT_TONG, { limit: 1 },
    );
    if (r.length > 0) return r[0];
  }
  const ma = input.ma_don?.trim();
  if (ma) {
    const r = await odoo.searchRead<Record<string, unknown>>(
      'sale.order', [['name', '=', ma]], COT_TONG, { limit: 1 },
    );
    if (r.length > 0) return r[0];
  }
  return null;
}

export async function suaVat(
  deps: SuaVatDeps,
  input: { don_id?: number; ma_don?: string; phan_tram: number },
): Promise<KetQuaVat> {
  const pt = Number(input.phan_tram);

  // Chặn giá trị vô nghĩa TRƯỚC khi chạm Odoo. 0 là HỢP LỆ — đó là lệnh BỎ VAT.
  if (!Number.isFinite(pt) || pt < 0 || pt > 100) {
    return {
      ok: false, donId: 0, maDon: '',
      lyDo:
        `Phần trăm VAT phải trong khoảng 0-100 (0 nghĩa là bỏ VAT). ` +
        `Nhận được: ${input.phan_tram}`,
    };
  }
  const boThue = pt === 0;

  const don = await timDon(deps.odoo, input);
  if (!don) {
    return {
      ok: false, donId: 0, maDon: '',
      lyDo:
        'Không tìm thấy đơn cần sửa VAT. Cần mã đơn dạng S13829 hoặc id đơn — ' +
        'đừng đoán bừa một đơn khác.',
    };
  }

  const donId = Number(don.id);
  const maDon = String(don.name ?? '');
  const state = String(don.state ?? '');

  // RANH GIỚI KẾ TOÁN — không nới, kể cả khi nhân viên yêu cầu.
  if (!(STATE_SUA_DUOC as readonly string[]).includes(state)) {
    const moTa = state === 'cancel' ? 'đã huỷ' : 'đã xác nhận';
    return {
      ok: false, donId, maDon,
      lyDo:
        `Đơn ${maDon} ${moTa} (state=${state}) nên KHÔNG sửa được VAT. ` +
        'Đơn đã xác nhận đã vào sổ kế toán và tồn kho — đổi thuế sẽ làm lệch số ' +
        'đã chốt. Cần đổi thì phải làm trong Odoo.',
    };
  }

  // Tra mức thuế TRƯỚC khi đọc dòng hàng: mức thuế không có (vd VAT 5% — prod
  // LEDNELIA chỉ có 4/8/10%) thì dừng ngay, không ghi nửa vời.
  let thueId = 0;
  let tenThue = '';
  if (!boThue) {
    const thue = await traThueBan({ odoo: deps.odoo }, pt);
    if (!thue) {
      return {
        ok: false, donId, maDon,
        lyDo:
          `Odoo KHÔNG có dòng thuế bán mức ${pt}% nên chưa gắn được VAT cho đơn ` +
          `${maDon}. Danh mục thuế bán hiện có các mức khác — nhân viên chọn mức ` +
          'có sẵn, hoặc nhờ kế toán thêm mức thuế này trong Odoo.',
      };
    }
    thueId = thue.id;
    tenThue = thue.ten;
  }

  const dong = await deps.odoo.searchRead<{ id: number }>(
    'sale.order.line', [['order_id', '=', donId]], ['id'], { limit: 200 },
  );
  if (dong.length === 0) {
    return { ok: false, donId, maDon, lyDo: `Đơn ${maDon} chưa có dòng hàng nào để gắn VAT.` };
  }

  // Ghi thuế cho TẤT CẢ dòng trong MỘT lần write.
  //
  // GẮN CẢ DÒNG TẶNG 0đ (quyết định 11/08): dòng tặng có price_unit = 0 nên
  // 0 × 8% = 0 — thuế không đổi một đồng nào. Nhưng hoá đơn Odoo gộp dòng theo
  // nhóm thuế: để sót dòng tặng ngoài nhóm thuế thì hoá đơn in ra có thêm một
  // khối "không chịu thuế" 0đ, nhân viên nhìn tưởng sót hàng. Gắn đều thì hoá
  // đơn sạch, mà tiền vẫn y nguyên.
  //
  // vals CHỈ có đúng một khoá `tax_id` — đây là hàng rào chống ca 20:40:27
  // ("nhân giá lên 1.08"). Đừng thêm price_unit/discount vào đây.
  const vals = { tax_id: [[6, 0, boThue ? [] : [thueId]]] };
  await deps.odoo.execute('sale.order.line', 'write', [dong.map((d) => d.id), vals], {});

  // ĐỌC LẠI từ Odoo — báo con số THẬT, không suy ra từ tổng × 1,08.
  const sau = await deps.odoo.searchRead<Record<string, unknown>>(
    'sale.order', [['id', '=', donId]], COT_TONG, { limit: 1 },
  );
  const s = sau[0] ?? {};

  return {
    ok: true,
    donId,
    maDon,
    boThue,
    phanTram: pt,
    ...(boThue ? {} : { thueId, tenThue }),
    soDong: dong.length,
    tienHang: Number(s.amount_untaxed ?? 0),
    tienThue: Number(s.amount_tax ?? 0),
    tongSau: Number(s.amount_total ?? 0),
  };
}

export const suaVatDefinition: ToolDefinition = {
  name: 'sua_vat',
  description:
    'THÊM / ĐỔI / BỎ VAT cho một đơn ĐÃ LÊN (đơn nháp đã tạo ở lượt trước). ' +
    'GỌI KHI nhân viên nói: "sửa lại thêm VAT 8%", "thêm VAT", "đơn này xuất VAT nữa em", ' +
    '"xuất VAT 10%", "làm hoá đơn đỏ", "bỏ VAT đi", "đơn S13829 thêm VAT 8%". ' +
    'ĐƯỢC PHÉP làm trực tiếp — KHÔNG hỏi lại "cộng vào tổng hay sửa giá dòng hàng", ' +
    'KHÔNG chuyển sale. Thêm VAT LUÔN nghĩa là gắn thuế vào đơn; Odoo tự tính tiền thuế. ' +
    'TUYỆT ĐỐI KHÔNG nhân giá dòng hàng lên (×1.08) để "cộng thuế" — làm vậy là ghi sai ' +
    'giá bán đã chốt với khách mà sổ thuế vẫn trống. Đừng dùng sua_don cho việc này. ' +
    'phan_tram = 0 nghĩa là BỎ VAT khỏi đơn. ' +
    'Chỉ sửa được đơn NHÁP; đơn đã xác nhận thì tool tự từ chối và báo lý do. ' +
    'Truyền don_id (ưu tiên, lấy từ tao_don_nhap/lượt trước) hoặc ma_don dạng S13829.',
  mutates: true,
  inputSchema: {
    type: 'object',
    properties: {
      don_id: { type: 'integer', description: 'id đơn, lấy từ tao_don_nhap hoặc lượt trước' },
      ma_don: { type: 'string', description: 'Mã đơn dạng S13829 (khi không có id)' },
      phan_tram: {
        type: 'number',
        description:
          'Mức VAT theo con số nhân viên nói: 8, 10, 4... Dùng 0 để BỎ VAT khỏi đơn. ' +
          'Nhân viên chỉ nói "thêm VAT" KHÔNG kèm mức → dùng 8 (mức mặc định công ty, ' +
          'đo 175/175 đơn có VAT đều 8%). ĐỪNG tự bịa mức nào khác — thuế là tiền thật ' +
          'trên sổ. Ca thật 19:55 12/08: "thêm VAT" bị model đoán 10% rồi phải sửa lại.',
      },
    },
    required: ['phan_tram'],
  },
};

/** VND không thập phân. */
function tien(n: number): string {
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}

export function dinhDangVat(kq: KetQuaVat): string {
  if (!kq.ok) {
    return (
      `KHÔNG sửa được VAT: ${kq.lyDo}\n` +
      'Báo rõ lý do cho nhân viên, ĐỪNG nói là đã thêm VAT xong.'
    );
  }

  if (kq.boThue) {
    return (
      `Đã bỏ VAT khỏi ${kq.soDong} dòng của đơn ${kq.maDon}.\n` +
      `Tiền hàng ${tien(kq.tienHang ?? 0)} + thuế ${tien(kq.tienThue ?? 0)} = ` +
      `${tien(kq.tongSau ?? 0)}\n` +
      'Số liệu đọc lại từ Odoo sau khi ghi, không phải tính tay.'
    );
  }

  return (
    `Đã thêm VAT ${kq.phanTram}% (${kq.tenThue}) cho ${kq.soDong} dòng của đơn ${kq.maDon}.\n` +
    `Tiền hàng ${tien(kq.tienHang ?? 0)} + thuế ${tien(kq.tienThue ?? 0)} = ` +
    `${tien(kq.tongSau ?? 0)}\n` +
    'Giá bán từng dòng GIỮ NGUYÊN — thuế nằm ở cột thuế, Odoo tự tính.\n' +
    'Số liệu đọc lại từ Odoo sau khi ghi, không phải tính tay.'
  );
}
