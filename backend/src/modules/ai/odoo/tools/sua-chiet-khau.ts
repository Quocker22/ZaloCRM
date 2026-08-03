// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: áp chiết khấu % lên đơn nháp.
//
// ĐÂY LÀ TOOL GHI thứ hai (sau tao_don_nhap) và là tool đầu tiên SỬA đơn đã
// tồn tại. Nó đụng thẳng vào tiền nên mọi ranh giới phải nằm trong CODE, không
// phải trong prompt — prompt có thể bị model bỏ qua.
//
// RANH GIỚI (anh chốt 2026-07-31):
//   - KHÔNG giới hạn % (0-100). Nhân viên gõ bao nhiêu, bot áp bấy nhiêu.
//   - CHỈ đơn NHÁP. Đơn đã xác nhận (state=sale/done) đã vào sổ kế toán và
//     tồn kho — sửa là làm lệch số liệu đã chốt. Đây KHÔNG phải chuyện tin hay
//     không tin nhân viên, mà là ranh giới kế toán.
//   - Đơn đã HUỶ (cancel) cũng không sửa — sửa xong chẳng để làm gì.

import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';

/** Trạng thái đơn CHO PHÉP sửa. Ngoài danh sách này là từ chối. */
const STATE_SUA_DUOC = ['draft', 'sent'] as const;

export interface KetQuaChietKhau {
  ok: boolean;
  donId: number;
  maDon: string;
  /** Lý do từ chối. Chỉ có khi ok=false. */
  lyDo?: string;
  phanTram?: number;
  tongTruoc?: number;
  tongSau?: number;
  soDong?: number;
}

export interface SuaChietKhauDeps {
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
}

/** Tìm đơn theo id hoặc mã. */
async function timDon(
  odoo: SuaChietKhauDeps['odoo'],
  input: { don_id?: number; ma_don?: string },
): Promise<Record<string, unknown> | null> {
  const fields = ['id', 'name', 'state', 'amount_total', 'partner_id'];
  if (input.don_id) {
    const r = await odoo.searchRead<Record<string, unknown>>(
      'sale.order', [['id', '=', input.don_id]], fields, { limit: 1 },
    );
    if (r.length > 0) return r[0];
  }
  const ma = input.ma_don?.trim();
  if (ma) {
    const r = await odoo.searchRead<Record<string, unknown>>(
      'sale.order', [['name', '=', ma]], fields, { limit: 1 },
    );
    if (r.length > 0) return r[0];
  }
  return null;
}

export async function suaChietKhau(
  deps: SuaChietKhauDeps,
  input: { don_id?: number; ma_don?: string; phan_tram: number },
): Promise<KetQuaChietKhau> {
  const pt = Number(input.phan_tram);

  // Chặn giá trị vô nghĩa TRƯỚC khi chạm Odoo: NaN sẽ ghi thành 0 âm thầm,
  // âm/quá 100 thì Odoo nhận nhưng tính ra số tiền vô lý.
  if (!Number.isFinite(pt) || pt < 0 || pt > 100) {
    return {
      ok: false, donId: 0, maDon: '',
      lyDo: `Chiết khấu phải trong khoảng 0-100%. Nhận được: ${input.phan_tram}`,
    };
  }

  const don = await timDon(deps.odoo, input);
  if (!don) {
    return { ok: false, donId: 0, maDon: '', lyDo: 'Không tìm thấy đơn' };
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
        `Đơn ${maDon} ${moTa} (state=${state}) nên KHÔNG sửa được chiết khấu. ` +
        'Đơn đã xác nhận đã vào sổ kế toán và tồn kho — sửa sẽ làm lệch số đã chốt. ' +
        'Cần đổi thì phải làm trong Odoo.',
    };
  }

  const dong = await deps.odoo.searchRead<{ id: number }>(
    'sale.order.line', [['order_id', '=', donId]], ['id'], { limit: 200 },
  );
  if (dong.length === 0) {
    return { ok: false, donId, maDon, lyDo: `Đơn ${maDon} chưa có dòng hàng nào` };
  }

  const tongTruoc = Number(don.amount_total ?? 0);

  // Ghi discount cho TẤT CẢ dòng trong một lần write — Odoo tự tính lại tổng.
  // KHÔNG tự nhân tay rồi ghi price_unit: đó là tự tính tiền, đúng lớp bug mà
  // hệ này đã trả giá ba lần.
  await deps.odoo.execute('sale.order.line', 'write', [dong.map((d) => d.id), { discount: pt }], {});

  // Đọc LẠI từ Odoo để lấy tổng thật, không suy ra từ phép nhân của mình.
  const sau = await deps.odoo.searchRead<{ amount_total: number }>(
    'sale.order', [['id', '=', donId]], ['amount_total'], { limit: 1 },
  );

  return {
    ok: true,
    donId,
    maDon,
    phanTram: pt,
    tongTruoc,
    tongSau: Number(sau[0]?.amount_total ?? 0),
    soDong: dong.length,
  };
}

export const suaChietKhauDefinition: ToolDefinition = {
  name: 'sua_chiet_khau',
  description:
    'Áp chiết khấu phần trăm lên TẤT CẢ dòng hàng của một đơn nháp. ' +
    'GỌI KHI nhân viên nói: "thêm chiết khấu 10%", "giảm giá 5% đơn này", ' +
    '"chiết khấu 15% cho đơn S13802". ' +
    'ĐƯỢC PHÉP làm trực tiếp — KHÔNG chuyển sale cho việc này. ' +
    'Chỉ sửa được đơn NHÁP; đơn đã xác nhận thì tool tự từ chối và báo lý do. ' +
    'Truyền don_id (ưu tiên) hoặc ma_don dạng S13802.',
  mutates: true,
  inputSchema: {
    type: 'object',
    properties: {
      don_id: { type: 'integer', description: 'id đơn, lấy từ tao_don_nhap hoặc lượt trước' },
      ma_don: { type: 'string', description: 'Mã đơn dạng S13802' },
      phan_tram: {
        type: 'number',
        description: 'Phần trăm chiết khấu, 0-100. Vd 10 nghĩa là giảm 10%.',
      },
    },
    required: ['phan_tram'],
  },
};

/** VND không thập phân. */
function tien(n: number): string {
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}

export function dinhDangChietKhau(kq: KetQuaChietKhau): string {
  if (!kq.ok) {
    return (
      `KHÔNG áp được chiết khấu: ${kq.lyDo}\n` +
      'Báo rõ lý do cho nhân viên, ĐỪNG nói là đã áp xong.'
    );
  }

  const giam = (kq.tongTruoc ?? 0) - (kq.tongSau ?? 0);
  return (
    `Đã áp chiết khấu ${kq.phanTram}% cho ${kq.soDong} dòng của đơn ${kq.maDon}.\n` +
    `Tổng: ${tien(kq.tongTruoc ?? 0)} → ${tien(kq.tongSau ?? 0)} (giảm ${tien(giam)})\n` +
    'Số liệu đọc lại từ Odoo sau khi ghi, không phải tính tay.'
  );
}
