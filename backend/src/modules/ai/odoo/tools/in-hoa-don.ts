// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool in_hoa_don — IN hoá đơn ra máy in ở shop (HP LaserJet Pro 4003, IPP).
//
// CHỈ ĐỌC Odoo + tạo job vào hàng đợi `print_jobs` — KHÔNG in thẳng trong
// lượt chat: máy in ở LAN shop qua cầu Tailscale, có thể chậm/tắt, không được
// giữ chân nhân viên. Cron may-in nhặt job in, in bù khi máy in sống lại.
//
// KHÁC xuat_hoa_don: cái đó GHI Odoo (xác nhận đơn + vào sổ lấy số). Tool này
// chỉ in tờ giấy của hoá đơn ĐÃ vào sổ. Đơn chưa có hoá đơn → chỉ đường sang
// xuat_hoa_don, không tự ý xuất (ghi ERP phải là quyết định rõ ràng của NV).
import type { OdooClient } from '../client.js';
import type { ToolDefinition } from '../../agent/types.js';
import { IDEMPOTENCY_PREFIX } from '../idempotency.js';
import { REPORT_HOA_DON } from './xuat-hoa-don.js';
import { REPORT_MAC_DINH as REPORT_DON_HANG } from '../hoa-don-anh.js';
import { HAU_TO_KHONG_GIA, type ThamSoThemJob } from '../../may-in/hang-doi-in.js';

/**
 * Xếp job vào hàng in — caller đã buộc sẵn prisma + orgId vào closure
 * (registry không biết orgId, nơi gọi runStaffAgent mới biết).
 */
export type ThemJobInHoaDon = (p: Omit<ThamSoThemJob, 'orgId'>) => Promise<void>;

export interface InHoaDonDeps {
  odoo: Pick<OdooClient, 'searchRead'>;
  /** Nói trống ("in hoá đơn") → lấy đơn mới nhất của hội thoại này. */
  conversationId?: string;
  themJob: ThemJobInHoaDon;
}

export type KetQuaInHoaDon =
  | {
      trangThai: 'da_xep_hang';
      soHoaDon: string;
      maDon: string;
      tenKhach: string;
      tongTien: number;
      /** true = in có giá (NV nói rõ); mặc định in KHÔNG giá (anh Quyết 26/08). */
      coGia: boolean;
      /** 'hoa_don' = tờ hoá đơn đã vào sổ; 'don_hang' = tờ đơn bán/báo giá (chưa cần hoá đơn). */
      loai: 'hoa_don' | 'don_hang';
    }
  | { trangThai: 'loi'; lyDo: string };

const FIELDS_DON = ['id', 'name', 'state', 'amount_total', 'partner_id', 'invoice_ids'];
const FIELDS_HD = ['id', 'name', 'state', 'amount_total', 'move_type', 'partner_id'];

/** Tìm đơn theo id → mã → đơn mới nhất của hội thoại (cùng nếp xuat_hoa_don). */
async function timDon(
  deps: InHoaDonDeps,
  input: { don_id?: number; ma_don?: string },
): Promise<Record<string, unknown> | null> {
  if (input.don_id) {
    const r = await deps.odoo.searchRead<Record<string, unknown>>(
      'sale.order', [['id', '=', input.don_id]], FIELDS_DON, { limit: 1 },
    );
    if (r.length > 0) return r[0];
  }
  const ma = input.ma_don?.trim();
  if (ma) {
    const r = await deps.odoo.searchRead<Record<string, unknown>>(
      'sale.order', [['name', '=', ma]], FIELDS_DON, { limit: 1 },
    );
    if (r.length > 0) return r[0];
  }
  if (!input.don_id && !ma && deps.conversationId?.trim()) {
    const r = await deps.odoo.searchRead<Record<string, unknown>>(
      'sale.order',
      [['client_order_ref', 'like', `${IDEMPOTENCY_PREFIX}:${deps.conversationId.trim()}:%`]],
      FIELDS_DON,
      { limit: 1, order: 'create_date desc' },
    );
    if (r.length > 0) return r[0];
  }
  return null;
}

export async function inHoaDon(
  deps: InHoaDonDeps,
  input: { so_hoa_don?: string; ma_don?: string; don_id?: number; co_gia?: boolean; loai?: 'hoa_don' | 'don_hang' },
): Promise<KetQuaInHoaDon> {
  const coGia = input.co_gia === true;
  const duoi = coGia ? '' : HAU_TO_KHONG_GIA;
  try {
    let hoaDon: Record<string, unknown> | null = null;
    let maDon = '';
    let tenKhach = '';

    // Đường 1: nhân viên đưa thẳng số hoá đơn (INV/2026/00042).
    const soHd = input.so_hoa_don?.trim();
    if (soHd) {
      const r = await deps.odoo.searchRead<Record<string, unknown>>(
        'account.move',
        [['name', '=', soHd], ['move_type', '=', 'out_invoice']],
        FIELDS_HD,
        { limit: 1 },
      );
      hoaDon = r[0] ?? null;
    }

    // Đường 2: qua đơn bán → hoá đơn mới nhất chưa huỷ của đơn.
    if (!hoaDon) {
      const don = await timDon(deps, input);
      if (!don && !soHd) {
        return {
          trangThai: 'loi',
          lyDo: 'Không tìm thấy đơn/hoá đơn. Truyền so_hoa_don (INV/...), ma_don (S13811) hoặc don_id; để trống nếu vừa làm đơn trong hội thoại này.',
        };
      }
      if (don) {
        maDon = String(don.name ?? '');
        tenKhach = Array.isArray(don.partner_id) ? String(don.partner_id[1] ?? '') : '';
        const ids = Array.isArray(don.invoice_ids) ? don.invoice_ids.map(Number) : [];
        // IN ĐƠN HÀNG (26/08, anh Quốc: "cả hoá đơn cả đơn hàng"): kho soạn
        // hàng cần tờ đơn NGAY khi lên đơn, chưa cần hoá đơn. Chưa có hoá đơn
        // → in tờ đơn bán (báo giá kiotviet), hoặc NV nói rõ "in đơn hàng".
        if (ids.length === 0 || input.loai === 'don_hang') {
          await deps.themJob({
            conversationId: deps.conversationId,
            hoaDonId: Number(don.id),
            soHoaDon: maDon,
            report: `${REPORT_DON_HANG}${duoi}`,
          });
          return {
            trangThai: 'da_xep_hang', soHoaDon: maDon, maDon, tenKhach,
            tongTien: Number(don.amount_total ?? 0), coGia, loai: 'don_hang',
          };
        }
        const hds = await deps.odoo.searchRead<Record<string, unknown>>(
          'account.move',
          [['id', 'in', ids], ['move_type', '=', 'out_invoice'], ['state', '!=', 'cancel']],
          FIELDS_HD,
          { limit: 1, order: 'id desc' },
        );
        hoaDon = hds[0] ?? null;
      }
    }

    if (!hoaDon) {
      return { trangThai: 'loi', lyDo: `Không tìm thấy hoá đơn${soHd ? ` ${soHd}` : ''}.` };
    }
    if (String(hoaDon.state) !== 'posted') {
      return {
        trangThai: 'loi',
        lyDo: 'Hoá đơn còn NHÁP (chưa vào sổ, chưa có số phát hành) — xuất bằng xuat_hoa_don trước rồi mới in.',
      };
    }

    const soHoaDon = String(hoaDon.name ?? '');
    if (!tenKhach && Array.isArray(hoaDon.partner_id)) tenKhach = String(hoaDon.partner_id[1] ?? '');
    await deps.themJob({
      conversationId: deps.conversationId,
      hoaDonId: Number(hoaDon.id),
      soHoaDon,
      // MẶC ĐỊNH KHÔNG GIÁ (anh Quyết 10:08 26/08: "in đơn đều là in đơn không
      // giá") — tờ in cho kho soạn hàng; NV nói rõ "in có giá" mới in giá.
      report: `${REPORT_HOA_DON}${duoi}`,
    });
    return {
      trangThai: 'da_xep_hang',
      soHoaDon,
      maDon,
      tenKhach,
      tongTien: Number(hoaDon.amount_total ?? 0),
      coGia,
      loai: 'hoa_don',
    };
  } catch (err) {
    return { trangThai: 'loi', lyDo: err instanceof Error ? err.message : String(err) };
  }
}

export const inHoaDonDefinition: ToolDefinition = {
  name: 'in_hoa_don',
  description:
    'IN hoá đơn HOẶC đơn hàng ra MÁY IN ở shop (tờ giấy thật). ' +
    'GỌI KHI nhân viên nói: "in đơn X", "in hoá đơn", "in bill đơn S13811", "in đơn hàng/báo giá S13811". ' +
    'Đơn ĐÃ có hoá đơn → in tờ hoá đơn; CHƯA có → tự in tờ ĐƠN HÀNG (không bắt xuất hoá đơn). ' +
    'NV nói rõ "in đơn hàng"/"in báo giá" → loai=don_hang (in tờ đơn dù đã có hoá đơn). ' +
    'KHÁC xuat_hoa_don: xuat_hoa_don GHI vào Odoo lấy số phát hành; in_hoa_don chỉ in giấy. ' +
    'Truyền so_hoa_don hoặc ma_don; nói trống → tự lấy đơn mới nhất của hội thoại. ' +
    'MẶC ĐỊNH in KHÔNG GIÁ (tờ cho kho soạn hàng): "in đơn X", "in đơn X không giá", ' +
    '"in không in giá" → KHÔNG truyền co_gia. Chỉ khi nhân viên nói rõ "in có giá"/"in giá" → co_gia=true. ' +
    'ĐỪNG đi tìm bảng/cột nào về "in giá" bằng kham_pha_odoo — tool này lo hết. ' +
    'Tool chỉ XẾP HÀNG in — máy in tắt thì job chờ, máy bật lại là in.',
  inputSchema: {
    type: 'object',
    properties: {
      so_hoa_don: { type: 'string', description: 'Số hoá đơn dạng INV/2026/00042.' },
      ma_don: { type: 'string', description: 'Mã đơn dạng S13811 — tool tự tìm hoá đơn của đơn.' },
      don_id: { type: 'integer', description: 'id đơn hàng, lấy từ kết quả tao_don_nhap.' },
      co_gia: {
        type: 'boolean',
        description: 'true CHỈ khi nhân viên nói rõ "in có giá"/"in giá". Không nói gì hoặc nói "không giá" → bỏ trống (mặc định không giá).',
      },
      loai: {
        type: 'string',
        enum: ['hoa_don', 'don_hang'],
        description: 'Bỏ trống = tự chọn (có hoá đơn thì in hoá đơn, chưa có thì in đơn hàng). "in đơn hàng"/"in báo giá" → don_hang.',
      },
    },
    required: [],
  },
  mutates: true,
};

export function dinhDangInHoaDon(kq: KetQuaInHoaDon): string {
  if (kq.trangThai === 'loi') return `Không in được hoá đơn: ${kq.lyDo}`;
  const tien = kq.tongTien.toLocaleString('vi-VN');
  const gia = kq.coGia ? 'bản CÓ GIÁ' : 'bản KHÔNG GIÁ (chỉ tên hàng + số lượng)';
  if (kq.loai === 'don_hang') {
    return (
      `Đã xếp hàng in ĐƠN HÀNG ${kq.maDon} · ${kq.tenKhach} · ${tien}đ — ${gia} (tờ đơn bán, chưa phải hoá đơn). ` +
      'Máy in ở shop sẽ nhả trong ít giây; nếu máy in đang tắt thì job chờ, bật lại là in.'
    );
  }
  const don = kq.maDon ? ` (đơn ${kq.maDon})` : '';
  return (
    `Đã xếp hàng in hoá đơn ${kq.soHoaDon}${don} · ${kq.tenKhach} · ${tien}đ — ${gia}. ` +
    'Máy in ở shop sẽ nhả trong ít giây; nếu máy in đang tắt thì job chờ, bật lại là in.'
  );
}
