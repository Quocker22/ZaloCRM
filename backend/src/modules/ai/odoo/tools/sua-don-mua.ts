// SPDX-License-Identifier: AGPL-3.0-or-later
// SỬA PHIẾU NHẬP HÀNG (purchase.order) — cặp đôi với sua-don.ts của đơn bán.
//
// Ca thật 22:35 16/08: phiếu P04525 tạo xong "1/1 dòng chưa có giá nhập —
// anh/chị vào link điền giá giúp em ạ" — trong khi bên đơn BÁN sửa giá được
// ngay trong chat. Anh Quốc: "tính năng nhập hàng đang thiếu và sai nhiều
// lắm so với lên đơn bán hàng á... 2 luồng nó cũng giống nhau".
//
// GIỮ HẸP so với sua_don bán: KHÔNG tặng (phiếu mua không có khái niệm hàng
// tặng của mình), KHÔNG kho/VAT (kế toán chỉnh trên Odoo khi xác nhận).
// Đổi SL + đổi/điền GIÁ NHẬP + thêm dòng — đúng ba việc NV cần làm qua chat.
import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';

/** Chỉ phiếu CHƯA xác nhận mới sửa được — đã 'purchase' là vào công nợ/kho. */
const STATE_SUA_DUOC = ['draft', 'sent'] as const;

export interface DongSuaMua {
  san_pham_id: number;
  so_luong: number;
  /** Giá NHẬP mới (đ/đơn vị). Không truyền = giữ giá đang có trên dòng. */
  gia_nhap?: number;
}

export interface KetQuaSuaDonMua {
  ok: boolean;
  donId: number;
  maDon: string;
  soDoi?: number;
  soThem?: number;
  tongTruoc?: number;
  tongSau?: number;
  lyDo?: string;
}

export interface SuaDonMuaDeps {
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
}

export async function suaDonMua(
  deps: SuaDonMuaDeps,
  input: { don_id?: number; ma_don?: string; doi?: DongSuaMua[]; them?: DongSuaMua[] },
): Promise<KetQuaSuaDonMua> {
  const doi = Array.isArray(input.doi) ? input.doi : [];
  const them = Array.isArray(input.them) ? input.them : [];
  if (doi.length === 0 && them.length === 0) {
    return { ok: false, donId: 0, maDon: '', lyDo: 'Không có gì để sửa (thiếu cả doi lẫn them).' };
  }
  for (const d of [...doi, ...them]) {
    if (!Number.isInteger(Number(d?.san_pham_id)) || Number(d.san_pham_id) <= 0) {
      return { ok: false, donId: 0, maDon: '', lyDo: `san_pham_id không hợp lệ: ${JSON.stringify(d?.san_pham_id)}.` };
    }
    if (!Number.isFinite(Number(d?.so_luong)) || Number(d.so_luong) <= 0) {
      return { ok: false, donId: 0, maDon: '', lyDo: `so_luong phải > 0, nhận: ${JSON.stringify(d?.so_luong)}` };
    }
  }

  // Tìm phiếu: ưu tiên id, rồi mã (P04525).
  let don: Record<string, unknown> | undefined;
  if (input.don_id) {
    [don] = await deps.odoo.searchRead<Record<string, unknown>>(
      'purchase.order', [['id', '=', Number(input.don_id)]], ['id', 'name', 'state', 'amount_total'], { limit: 1 },
    );
  } else if (input.ma_don?.trim()) {
    [don] = await deps.odoo.searchRead<Record<string, unknown>>(
      'purchase.order', [['name', '=', input.ma_don.trim()]], ['id', 'name', 'state', 'amount_total'], { limit: 1 },
    );
  }
  if (!don) return { ok: false, donId: 0, maDon: '', lyDo: 'Không tìm thấy phiếu nhập cần sửa.' };

  const donId = Number(don.id);
  const maDon = String(don.name ?? '');
  const state = String(don.state ?? '');
  if (!(STATE_SUA_DUOC as readonly string[]).includes(state)) {
    return {
      ok: false, donId, maDon,
      lyDo:
        `Phiếu ${maDon} đã ${state === 'cancel' ? 'huỷ' : 'xác nhận'} (state=${state}) nên KHÔNG sửa được qua chat. ` +
        'Phiếu đã xác nhận đã chạm kho/công nợ — cần đổi thì làm trong Odoo.',
    };
  }
  const tongTruoc = Number(don.amount_total ?? 0);

  const dongHienCo = await deps.odoo.searchRead<{ id: number; product_id: [number, string] | false }>(
    'purchase.order.line', [['order_id', '=', donId]], ['id', 'product_id'], { limit: 200 },
  );
  const idTheoSp = new Map<number, number>();
  for (const d of dongHienCo) {
    if (Array.isArray(d.product_id)) idTheoSp.set(Number(d.product_id[0]), d.id);
  }

  const giaNeuCo = (d: DongSuaMua) =>
    Number.isFinite(Number(d.gia_nhap)) && Number(d.gia_nhap) > 0
      ? { price_unit: Number(d.gia_nhap) }
      : {};

  let soDoi = 0;
  let soThem = 0;
  for (const d of doi) {
    const lineId = idTheoSp.get(Number(d.san_pham_id));
    if (lineId) {
      await deps.odoo.execute('purchase.order.line', 'write',
        [[lineId], { product_qty: Number(d.so_luong), ...giaNeuCo(d) }], {});
      soDoi++;
    } else {
      await deps.odoo.execute('purchase.order.line', 'create',
        [{ order_id: donId, product_id: Number(d.san_pham_id), product_qty: Number(d.so_luong), ...giaNeuCo(d) }], {});
      soThem++;
    }
  }
  for (const d of them) {
    await deps.odoo.execute('purchase.order.line', 'create',
      [{ order_id: donId, product_id: Number(d.san_pham_id), product_qty: Number(d.so_luong), ...giaNeuCo(d) }], {});
    soThem++;
  }

  const sau = await deps.odoo.searchRead<{ amount_total: number }>(
    'purchase.order', [['id', '=', donId]], ['amount_total'], { limit: 1 },
  );
  return { ok: true, donId, maDon, soDoi, soThem, tongTruoc, tongSau: Number(sau[0]?.amount_total ?? 0) };
}

export function dinhDangSuaDonMua(kq: KetQuaSuaDonMua): string {
  if (!kq.ok) return `Không sửa được phiếu nhập${kq.maDon ? ` ${kq.maDon}` : ''}: ${kq.lyDo ?? 'Odoo từ chối'}`;
  const tien = (n?: number) => `${Math.round(n ?? 0).toLocaleString('vi-VN')}đ`;
  return (
    `Đã sửa phiếu nhập ${kq.maDon} (${kq.soDoi ?? 0} dòng đổi, ${kq.soThem ?? 0} dòng thêm). ` +
    `Tổng ${tien(kq.tongTruoc)} → ${tien(kq.tongSau)}. Phiếu vẫn ở trạng thái nháp.`
  );
}

export const suaDonMuaDefinition: ToolDefinition = {
  name: 'sua_don_mua',
  description:
    'SỬA phiếu NHẬP HÀNG nháp (đơn mua): đổi số lượng, điền/đổi GIÁ NHẬP, thêm dòng. ' +
    'GỌI KHI nhân viên nói về PHIẾU NHẬP: "sửa phiếu nhập...", "giá nhập 78k", ' +
    '"thêm 500 cái vào phiếu". Cần don_id hoặc ma_don dạng P04525. ' +
    'Chỉ sửa được phiếu NHÁP; đã xác nhận thì tool tự từ chối.',
  mutates: true,
  inputSchema: {
    type: 'object',
    properties: {
      don_id: { type: 'integer', description: 'id phiếu nhập (từ tao_don_mua/lượt trước)' },
      ma_don: { type: 'string', description: 'Mã phiếu dạng P04525 (khi không có id)' },
      doi: {
        type: 'array',
        description: 'Đổi SL/giá nhập cho SP đã có trong phiếu. SP chưa có thì tự thêm.',
        items: {
          type: 'object',
          properties: {
            san_pham_id: { type: 'integer', description: 'id sản phẩm, từ tra_san_pham' },
            so_luong: { type: 'number', description: 'Số lượng MỚI (thay thế), > 0' },
            gia_nhap: { type: 'number', description: 'Giá NHẬP mới (đ). Bỏ trống = giữ nguyên.' },
          },
          required: ['san_pham_id', 'so_luong'],
        },
      },
      them: {
        type: 'array',
        description: 'Thêm dòng hàng mới vào phiếu.',
        items: {
          type: 'object',
          properties: {
            san_pham_id: { type: 'integer', description: 'id sản phẩm' },
            so_luong: { type: 'number', description: 'Số lượng, > 0' },
            gia_nhap: { type: 'number', description: 'Giá nhập (đ), nếu biết' },
          },
          required: ['san_pham_id', 'so_luong'],
        },
      },
    },
    required: [],
  },
};
