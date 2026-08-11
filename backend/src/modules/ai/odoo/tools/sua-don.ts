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
import { lenhGanThue } from './tao-don-nhap.js';

const STATE_SUA_DUOC = ['draft', 'sent'] as const;

/**
 * price_unit chỉ gửi khi NHÂN VIÊN có báo giá. Không báo → để Odoo tự lấy
 * pricelist như cũ (bot không tự nghĩ ra giá — luật đó không đổi).
 */
function giaNeuCo(d: DongSua): {
  price_unit?: number; discount?: number; tax_id?: Array<[number, number, number[]]>;
} {
  // VAT (11/08): tính TRƯỚC nhánh tặng — dòng tặng vẫn phải gắn thuế cho hoá
  // đơn nhất quán (0đ × 8% = 0đ, không đổi tiền). Chỉ giá/chiết khấu mới bị
  // nhánh tặng nuốt.
  const thue = lenhGanThue(d.thue_id);
  const vat = thue ? { tax_id: thue } : {};
  // Dòng TẶNG: giá LUÔN 0, bỏ qua mọi giá/chiết khấu lỡ truyền vào.
  if (d.tang === true) return { price_unit: 0, ...vat };
  const g = Number(d.don_gia);
  // Chiết khấu cùng luật với giá (11/08): chỉ nhận 0-100, ghi bừa là sai tiền
  // thật của khách. "Hai đường phải cùng luật" — bài học bug 17:41 10/08.
  const c = Number(d.chiet_khau);
  return {
    ...(g > 0 ? { price_unit: g } : {}),
    ...(Number.isFinite(c) && c > 0 && c <= 100 ? { discount: c } : {}),
    ...vat,
  };
}

export interface DongSua {
  san_pham_id: number;
  so_luong: number;
  /**
   * Đơn giá NHÂN VIÊN BÁO (đồng). Bug thật 17:41 10/08: NV nói "thêm 300 led
   * tỏa giá 300đ", hoá đơn ghi 1đ/thanh vì đường SỬA đơn bỏ mất giá — trong
   * khi đường TẠO đơn đã nhận giá từ 17:39. Hai đường phải cùng luật.
   */
  don_gia?: number;
  /**
   * Chiết khấu % (0-100). Cùng lý do với `don_gia`: đường TẠO đơn nhận từ
   * 11/08 thì đường SỬA cũng phải nhận, nếu không nhân viên sửa đơn xong mất
   * chiết khấu mà không ai biết.
   */
  chiet_khau?: number;
  /**
   * Dòng HÀNG TẶNG (giá 0đ + tên gắn "(tặng)"). Cùng lý do với `don_gia` và
   * `chiet_khau`: đường TẠO đơn nhận thì đường SỬA cũng phải nhận, nếu không
   * nhân viên thêm hàng tặng vào đơn cũ lại ra dòng nguyên giá.
   *
   * Đây là lần thứ TƯ cùng một bài học — xem comment `don_gia` ở trên.
   */
  tang?: boolean;
  /**
   * id dòng thuế VAT (account.tax) — cơ chế thuế sẵn có của Odoo.
   *
   * LẦN THỨ NĂM của cùng một bài học (giá 10/08, chiết khấu 11/08, tặng kèm
   * 11/08): đường TẠO đơn nhận thì đường SỬA cũng phải nhận. Không thì nhân
   * viên "đơn này xuất VAT nữa em" xong đơn vẫn không thuế, mà hoá đơn đã kế
   * thừa từ đơn nên sai luôn cả sổ.
   *
   * Không truyền = KHÔNG đụng tax_id của đơn đang có: đơn cũ có thể đã gắn
   * thuế từ lúc tạo, ghi đè im lặng là xoá mất thuế thật.
   */
  thue_id?: number;
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
  input: {
    don_id?: number; ma_don?: string; doi?: DongSua[]; them?: DongSua[];
    /** Đổi kho xuất hàng của đơn. Không truyền = giữ nguyên kho đơn đang có. */
    kho_id?: number;
  },
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

  // Tên SP — chỉ tra khi CÓ dòng tặng, để không tốn thêm round-trip XML-RPC
  // cho ca sửa đơn thường (không tặng gì).
  const coTang = [...doi, ...them].some((d) => d.tang === true);
  const tenTheoId = new Map<number, string>();
  if (coTang) {
    const sp = await deps.odoo.searchRead<{ id: number; name: string }>(
      'product.product',
      [['id', 'in', [...doi, ...them].filter((d) => d.tang).map((d) => Number(d.san_pham_id))]],
      ['id', 'name'],
      { limit: 50 },
    );
    for (const s of sp) tenTheoId.set(Number(s.id), String(s.name ?? ''));
  }
  /** Vals của một dòng tạo mới; dòng tặng gắn thêm dấu "(tặng)" vào tên. */
  const valsMoi = (d: DongSua) => ({
    order_id: donId,
    product_id: Number(d.san_pham_id),
    product_uom_qty: Number(d.so_luong),
    ...(d.tang === true
      ? { name: `${tenTheoId.get(Number(d.san_pham_id)) ?? ''} (tặng)`.trim() }
      : {}),
    ...giaNeuCo(d),
  });

  let soDoiSL = 0;
  let soThem = 0;

  // 1) ĐỔI số lượng — SP đã có thì write dòng đó; chưa có thì rơi xuống "thêm".
  for (const d of doi) {
    const spId = Number(d.san_pham_id);
    const lineId = idTheoSp.get(spId);
    // Dòng TẶNG luôn là dòng RIÊNG, kể cả khi SP đó đã có trong đơn: "10 cái
    // ovp k2, tặng thêm 1 cái" mà write đè lên dòng bán thì đơn mất luôn 10 cái
    // đang bán, còn đúng 1 cái giá 0đ. Tặng thì CREATE, không bao giờ WRITE.
    if (lineId && d.tang !== true) {
      await deps.odoo.execute('sale.order.line', 'write',
        [[lineId], { product_uom_qty: Number(d.so_luong), ...giaNeuCo(d) }], {});
      soDoiSL++;
    } else {
      // SP chưa có trong đơn (hoặc là dòng tặng) → tạo dòng mới.
      await deps.odoo.execute('sale.order.line', 'create', [valsMoi(d)], {});
      soThem++;
    }
  }

  // 2) THÊM dòng hàng mới (không kiểm trùng — nhân viên chủ động thêm).
  for (const d of them) {
    await deps.odoo.execute('sale.order.line', 'create', [valsMoi(d)], {});
    soThem++;
  }

  // 3) ĐỔI KHO của đơn — chỉ khi nhân viên nói rõ. Không nói thì KHÔNG đụng:
  //    đơn cũ đã có kho từ lúc tạo, ghi đè im lặng là đổi nơi xuất hàng thật.
  const khoTho = Number(input.kho_id);
  if (Number.isInteger(khoTho) && khoTho > 0) {
    await deps.odoo.execute('sale.order', 'write', [[donId], { warehouse_id: khoTho }], {});
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
