// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool: SỬA đơn nháp đã tạo — đổi số lượng một SP, và/hoặc THÊM dòng hàng mới.
//
// Vì sao cần (07/08/2026): nhân viên hay "lên đơn 10 cái" rồi "sửa thành 100
// cái, thêm 100 cáp". Trước đây KHÔNG có tool sửa dòng — bot đành tạo đơn MỚI
// (data bẩn) hoặc bịa "đã sửa". Tool này sửa THẲNG đơn cũ trên Odoo.
//
// RANH GIỚI (cùng nguyên tắc sua_chiet_khau):
//   - CHỈ đơn NHÁP (draft/sent). Đơn đã xác nhận/huỷ → từ chối, báo lý do.
//   - KHÔNG tự tính tiền: chỉ ghi product_uom_qty / thêm dòng, Odoo tự tính tổng.
//   - Đọc LẠI tổng từ Odoo sau khi ghi, không suy ra từ phép nhân của mình.
import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';

const STATE_SUA_DUOC = ['draft', 'sent'] as const;

export interface DongSua {
  san_pham_id: number;
  so_luong: number;
}

export interface KetQuaSuaDon {
  ok: boolean;
  donId: number;
  maDon: string;
  lyDo?: string;
  soDoiSL?: number;   // số dòng đổi số lượng
  soThem?: number;    // số dòng thêm mới
  tongTruoc?: number;
  tongSau?: number;
}

export interface SuaDonDeps {
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
}

async function timDon(
  odoo: SuaDonDeps['odoo'],
  input: { don_id?: number; ma_don?: string },
): Promise<Record<string, unknown> | null> {
  const fields = ['id', 'name', 'state', 'amount_total'];
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

/**
 * Sửa đơn nháp. `doi` = đổi số lượng cho SP đã có (khớp product_id); nếu SP chưa
 * có trong đơn thì THÊM mới. `them` = thêm dòng hàng mới (không kiểm trùng).
 */
export async function suaDon(
  deps: SuaDonDeps,
  input: { don_id?: number; ma_don?: string; doi?: DongSua[]; them?: DongSua[] },
): Promise<KetQuaSuaDon> {
  const doi = Array.isArray(input.doi) ? input.doi : [];
  const them = Array.isArray(input.them) ? input.them : [];
  if (doi.length === 0 && them.length === 0) {
    return { ok: false, donId: 0, maDon: '', lyDo: 'Không có gì để sửa (thiếu cả doi lẫn them).' };
  }
  for (const d of [...doi, ...them]) {
    if (!Number.isInteger(Number(d?.san_pham_id)) || Number(d.san_pham_id) <= 0) {
      return { ok: false, donId: 0, maDon: '', lyDo: `san_pham_id không hợp lệ: ${JSON.stringify(d?.san_pham_id)}. Dùng tra_san_pham.` };
    }
    if (!Number.isFinite(Number(d?.so_luong)) || Number(d.so_luong) <= 0) {
      return { ok: false, donId: 0, maDon: '', lyDo: `so_luong phải > 0, nhận: ${JSON.stringify(d?.so_luong)}` };
    }
  }

  const don = await timDon(deps.odoo, input);
  if (!don) return { ok: false, donId: 0, maDon: '', lyDo: 'Không tìm thấy đơn cần sửa.' };

  const donId = Number(don.id);
  const maDon = String(don.name ?? '');
  const state = String(don.state ?? '');
  if (!(STATE_SUA_DUOC as readonly string[]).includes(state)) {
    const moTa = state === 'cancel' ? 'đã huỷ' : 'đã xác nhận';
    return {
      ok: false, donId, maDon,
      lyDo:
        `Đơn ${maDon} ${moTa} (state=${state}) nên KHÔNG sửa được. ` +
        'Đơn đã xác nhận đã vào sổ kế toán/tồn kho — cần đổi thì làm trong Odoo.',
    };
  }

  const tongTruoc = Number(don.amount_total ?? 0);

  // Dòng hiện có, để đổi SL đúng dòng theo product_id.
  const dongHienCo = await deps.odoo.searchRead<{ id: number; product_id: [number, string] | false }>(
    'sale.order.line', [['order_id', '=', donId]], ['id', 'product_id'], { limit: 200 },
  );
  const idTheoSp = new Map<number, number>();
  for (const d of dongHienCo) {
    if (Array.isArray(d.product_id)) idTheoSp.set(Number(d.product_id[0]), d.id);
  }

  let soDoiSL = 0;
  let soThem = 0;

  // 1) ĐỔI số lượng — SP đã có thì write dòng đó; chưa có thì rơi xuống "thêm".
  for (const d of doi) {
    const spId = Number(d.san_pham_id);
    const lineId = idTheoSp.get(spId);
    if (lineId) {
      await deps.odoo.execute('sale.order.line', 'write', [[lineId], { product_uom_qty: Number(d.so_luong) }], {});
      soDoiSL++;
    } else {
      // SP chưa có trong đơn → tạo dòng mới (đổi thành thêm).
      await deps.odoo.execute('sale.order.line', 'create',
        [{ order_id: donId, product_id: spId, product_uom_qty: Number(d.so_luong) }], {});
      soThem++;
    }
  }

  // 2) THÊM dòng hàng mới (không kiểm trùng — nhân viên chủ động thêm).
  for (const d of them) {
    await deps.odoo.execute('sale.order.line', 'create',
      [{ order_id: donId, product_id: Number(d.san_pham_id), product_uom_qty: Number(d.so_luong) }], {});
    soThem++;
  }

  // Đọc LẠI tổng thật từ Odoo.
  const sau = await deps.odoo.searchRead<{ amount_total: number }>(
    'sale.order', [['id', '=', donId]], ['amount_total'], { limit: 1 },
  );

  return {
    ok: true, donId, maDon, soDoiSL, soThem,
    tongTruoc, tongSau: Number(sau[0]?.amount_total ?? 0),
  };
}

export const suaDonDefinition: ToolDefinition = {
  name: 'sua_don',
  description:
    'SỬA đơn NHÁP đã tạo: đổi số lượng một sản phẩm và/hoặc THÊM dòng hàng mới. ' +
    'GỌI KHI nhân viên nói: "sửa đơn thành 100 cái", "đổi số lượng", "thêm 100 cáp vào đơn", ' +
    '"bớt còn 5 cái". Sửa THẲNG đơn cũ — KHÔNG tạo đơn mới. ' +
    'Cần don_id (ưu tiên, lấy từ tao_don_nhap/lượt trước) hoặc ma_don dạng S13802. ' +
    'doi: đổi số lượng SP đã có (khớp theo id); them: thêm SP mới. id sản phẩm lấy từ tra_san_pham. ' +
    'Chỉ sửa được đơn NHÁP; đơn đã xác nhận thì tool tự từ chối.',
  mutates: true,
  inputSchema: {
    type: 'object',
    properties: {
      don_id: { type: 'integer', description: 'id đơn cần sửa, lấy từ tao_don_nhap hoặc lượt trước' },
      ma_don: { type: 'string', description: 'Mã đơn dạng S13802 (khi không có id)' },
      doi: {
        type: 'array',
        description: 'Đổi số lượng cho SP đã có trong đơn. SP chưa có thì tự thêm.',
        items: {
          type: 'object',
          properties: {
            san_pham_id: { type: 'integer', description: 'id sản phẩm, từ tra_san_pham' },
            so_luong: { type: 'number', description: 'Số lượng MỚI (thay thế, không cộng dồn), > 0' },
          },
          required: ['san_pham_id', 'so_luong'],
        },
      },
      them: {
        type: 'array',
        description: 'Thêm dòng hàng mới vào đơn.',
        items: {
          type: 'object',
          properties: {
            san_pham_id: { type: 'integer', description: 'id sản phẩm, từ tra_san_pham' },
            so_luong: { type: 'number', description: 'Số lượng, > 0' },
          },
          required: ['san_pham_id', 'so_luong'],
        },
      },
    },
    required: [],
  },
};

function tien(n: number): string {
  return `${Math.round(n).toLocaleString('vi-VN')}đ`;
}

export function dinhDangSuaDon(kq: KetQuaSuaDon): string {
  if (!kq.ok) {
    return `KHÔNG sửa được đơn: ${kq.lyDo}\nBáo rõ lý do cho nhân viên, ĐỪNG nói đã sửa xong.`;
  }
  const phan: string[] = [];
  if (kq.soDoiSL) phan.push(`đổi SL ${kq.soDoiSL} dòng`);
  if (kq.soThem) phan.push(`thêm ${kq.soThem} dòng`);
  return (
    `Đã sửa đơn ${kq.maDon} (${phan.join(', ')}).\n` +
    `Tổng: ${tien(kq.tongTruoc ?? 0)} → ${tien(kq.tongSau ?? 0)}\n` +
    'Số liệu đọc lại từ Odoo sau khi ghi. Gửi lại ảnh hoá đơn cho nhân viên xem.'
  );
}
