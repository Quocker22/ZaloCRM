// SPDX-License-Identifier: AGPL-3.0-or-later
// XUẤT HOÁ ĐƠN KẾ TOÁN chính thức (account.move) từ đơn bán — anh chốt 07/08:
// POST luôn lấy số phát hành, không để nháp.
//
// Đây là tool GHI ERP nặng nhất của bot (xác nhận đơn + tạo hoá đơn + vào sổ),
// nên hai hợp đồng cứng:
//   1. IDEMPOTENT: đơn đã có hoá đơn → trả lại cái cũ, TUYỆT ĐỐI không xuất đôi.
//   2. CHỈ registry NHÂN VIÊN — khách không bao giờ với tới (như tra_khach_hang).
//
// KHÁC `gui_hoa_don`: cái đó chỉ render ẢNH báo giá, không ghi gì vào Odoo.
import type { ToolDefinition } from '../../agent/types.js';
import type { OdooClient } from '../client.js';
import { IDEMPOTENCY_PREFIX } from '../idempotency.js';

export interface XuatHoaDonDeps {
  odoo: Pick<OdooClient, 'searchRead' | 'execute'>;
  /** Gốc URL Odoo công khai — dựng link mở thẳng hoá đơn. */
  odooUrl: string;
  /** Nói trống ("xuất hoá đơn") → lấy đơn mới nhất của hội thoại này. */
  conversationId?: string;
}

export type KetQuaXuatHoaDon =
  | {
      trangThai: 'da_xuat' | 'da_co_truoc';
      hoaDonId: number;
      /** Số hoá đơn CHÍNH THỨC sau khi vào sổ, vd INV/2026/00042. */
      soHoaDon: string;
      maDon: string;
      tenKhach: string;
      tongTien: number;
      link: string;
    }
  | { trangThai: 'loi'; lyDo: string };

/** Link mở thẳng hoá đơn trong Odoo (menu Hoá đơn — action 514, menu 370). */
function linkHoaDon(odooUrl: string, hoaDonId: number): string {
  const goc = odooUrl.replace(/\/+$/, '');
  return `${goc}/web#id=${hoaDonId}&cids=1&menu_id=370&action=514&model=account.move&view_type=form`;
}

const FIELDS_DON = ['id', 'name', 'state', 'amount_total', 'partner_id', 'invoice_ids'];
const FIELDS_HD = ['id', 'name', 'state', 'amount_total', 'move_type'];

/**
 * Gọi action Odoo kiểu void — NUỐT lỗi "cannot marshal None".
 *
 * Bug thật 23:33 07/08 (S13815): action_confirm/create_invoices/action_post
 * phía server CHẠY XONG rồi trả về None (Python), tầng XML-RPC không serialize
 * được nên ném TypeError — tức lỗi chỉ ở khâu trả về, việc đã làm xong. Ném
 * tiếp thì flow bỏ dở giữa chừng (đơn confirm rồi, hoá đơn kẹt nháp). Nuốt lỗi
 * này và để caller XÁC MINH bằng cách đọc lại trạng thái — không tin return.
 * Lỗi khác (Access Denied, nothing to invoice…) vẫn ném nguyên vẹn.
 */
async function goiActionOdoo(
  odoo: XuatHoaDonDeps['odoo'],
  model: string,
  method: string,
  args: unknown[],
  kwargs?: Record<string, unknown>,
): Promise<void> {
  try {
    await odoo.execute(model, method, args, kwargs);
  } catch (err) {
    const loi = err instanceof Error ? err.message : String(err);
    if (!loi.includes('cannot marshal None')) throw err;
  }
}

/** Tìm đơn theo id → mã → đơn mới nhất của hội thoại (cùng nếp gui_hoa_don). */
async function timDon(
  deps: XuatHoaDonDeps,
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

export async function xuatHoaDon(
  deps: XuatHoaDonDeps,
  input: { don_id?: number; ma_don?: string },
): Promise<KetQuaXuatHoaDon> {
  const don = await timDon(deps, input);
  if (!don) {
    return {
      trangThai: 'loi',
      lyDo: 'Không tìm thấy đơn. Truyền don_id/ma_don (dạng S13811), hoặc để trống nếu vừa tạo đơn trong hội thoại này.',
    };
  }
  const donId = Number(don.id);
  const maDon = String(don.name ?? '');
  const tenKhach = Array.isArray(don.partner_id) ? String(don.partner_id[1] ?? '') : '';

  try {
    // ── IDEMPOTENT: đơn đã có hoá đơn thì dùng lại, không xuất đôi ─────────
    const idsCu = Array.isArray(don.invoice_ids) ? don.invoice_ids.map(Number) : [];
    let hoaDon: Record<string, unknown> | null = null;
    if (idsCu.length > 0) {
      const hds = await deps.odoo.searchRead<Record<string, unknown>>(
        'account.move',
        [['id', 'in', idsCu], ['move_type', '=', 'out_invoice'], ['state', '!=', 'cancel']],
        FIELDS_HD,
        { limit: 1, order: 'id desc' },
      );
      hoaDon = hds[0] ?? null;
    }

    if (hoaDon && String(hoaDon.state) === 'posted') {
      return {
        trangThai: 'da_co_truoc',
        hoaDonId: Number(hoaDon.id),
        soHoaDon: String(hoaDon.name ?? ''),
        maDon, tenKhach,
        tongTien: Number(hoaDon.amount_total ?? 0),
        link: linkHoaDon(deps.odooUrl, Number(hoaDon.id)),
      };
    }

    // ── Chưa có hoá đơn: xác nhận đơn (nếu còn nháp) rồi tạo qua wizard ────
    if (!hoaDon) {
      if (String(don.state) === 'draft') {
        await goiActionOdoo(deps.odoo, 'sale.order', 'action_confirm', [[donId]]);
      }
      // Wizard chuẩn của Odoo — method create_invoices là public, gọi được qua
      // XML-RPC (khác _create_invoices bị chặn vì tên bắt đầu bằng "_").
      const ctx = { context: { active_model: 'sale.order', active_ids: [donId], active_id: donId } };
      const wizardId = await deps.odoo.execute<number>(
        'sale.advance.payment.inv', 'create',
        [{ advance_payment_method: 'delivered' }], ctx,
      );
      await goiActionOdoo(deps.odoo, 'sale.advance.payment.inv', 'create_invoices', [[wizardId]], ctx);

      const donSau = await deps.odoo.searchRead<Record<string, unknown>>(
        'sale.order', [['id', '=', donId]], FIELDS_DON, { limit: 1 },
      );
      const idsMoi = Array.isArray(donSau[0]?.invoice_ids) ? (donSau[0].invoice_ids as unknown[]).map(Number) : [];
      const hds = await deps.odoo.searchRead<Record<string, unknown>>(
        'account.move',
        [['id', 'in', idsMoi], ['move_type', '=', 'out_invoice'], ['state', '!=', 'cancel']],
        FIELDS_HD,
        { limit: 1, order: 'id desc' },
      );
      hoaDon = hds[0] ?? null;
      if (!hoaDon) {
        return { trangThai: 'loi', lyDo: `Đã chạy tạo hoá đơn cho đơn ${maDon} nhưng đọc lại không thấy. Cần kiểm tra thủ công trong Odoo.` };
      }
    }

    // ── VÀO SỔ (POST) — hoá đơn lấy số phát hành chính thức ────────────────
    const hoaDonId = Number(hoaDon.id);
    if (String(hoaDon.state) !== 'posted') {
      await goiActionOdoo(deps.odoo, 'account.move', 'action_post', [[hoaDonId]]);
    }
    // XÁC MINH bằng đọc lại — vì goiActionOdoo nuốt marshal-None nên trạng
    // thái thật chỉ biết được từ đây, không phải từ giá trị action trả về.
    const sauPost = await deps.odoo.searchRead<Record<string, unknown>>(
      'account.move', [['id', '=', hoaDonId]], FIELDS_HD, { limit: 1 },
    );
    const cuoi = sauPost[0] ?? hoaDon;
    if (String(cuoi.state) !== 'posted') {
      return {
        trangThai: 'loi',
        lyDo: `Hoá đơn của đơn ${maDon} đã tạo (id=${hoaDonId}) nhưng vào sổ không thành — đọc lại state='${cuoi.state}'. Thử lại "xuất hoá đơn" hoặc vào Odoo bấm Vào sổ.`,
      };
    }

    return {
      trangThai: 'da_xuat',
      hoaDonId,
      soHoaDon: String(cuoi.name ?? ''),
      maDon, tenKhach,
      tongTien: Number(cuoi.amount_total ?? 0),
      link: linkHoaDon(deps.odooUrl, hoaDonId),
    };
  } catch (err) {
    // Lỗi Odoo (nothing to invoice, kỳ kế toán khoá…) phải tới tai nhân viên
    // nguyên văn — họ là người xử tiếp, không được nuốt.
    const loi = err instanceof Error ? err.message : String(err);
    return { trangThai: 'loi', lyDo: `Odoo từ chối xuất hoá đơn cho đơn ${maDon}: ${loi}` };
  }
}

export const xuatHoaDonDefinition: ToolDefinition = {
  name: 'xuat_hoa_don',
  description:
    'XUẤT HOÁ ĐƠN KẾ TOÁN chính thức trong Odoo (account.move): xác nhận đơn, ' +
    'tạo hoá đơn và VÀO SỔ lấy số phát hành. ' +
    'GỌI KHI nhân viên nói: "xuất hóa đơn", "xuất hoá đơn đơn S13811", "xuất bill", ' +
    '"lên hoá đơn cho đơn này". ' +
    'KHÁC gui_hoa_don: gui_hoa_don chỉ gửi ẢNH báo giá, không ghi gì vào Odoo. ' +
    'Truyền don_id hoặc ma_don; nhân viên nói TRỐNG không kèm mã → gọi KHÔNG ' +
    'THAM SỐ, tool tự lấy đơn mới nhất của hội thoại. ' +
    'Đơn đã có hoá đơn thì trả lại hoá đơn cũ, không bao giờ xuất đôi.',
  inputSchema: {
    type: 'object',
    properties: {
      don_id: { type: 'integer', description: 'id đơn hàng, lấy từ kết quả tao_don_nhap.' },
      ma_don: { type: 'string', description: 'Mã đơn dạng S13811. Dùng khi nhân viên nói mã.' },
    },
    required: [],
  },
  mutates: true,
};

export function dinhDangXuatHoaDon(kq: KetQuaXuatHoaDon): string {
  if (kq.trangThai === 'loi') return `Không xuất được hoá đơn: ${kq.lyDo}`;
  const tien = kq.tongTien.toLocaleString('vi-VN');
  if (kq.trangThai === 'da_co_truoc') {
    return (
      `Đơn ${kq.maDon} ĐÃ có hoá đơn từ trước: ${kq.soHoaDon} · ${kq.tenKhach} · ${tien}đ. ` +
      `KHÔNG xuất thêm. Link: ${kq.link}`
    );
  }
  return (
    `Đã xuất hoá đơn CHÍNH THỨC ${kq.soHoaDon} (đã vào sổ) cho đơn ${kq.maDon} · ` +
    `${kq.tenKhach} · ${tien}đ. Link: ${kq.link}. ` +
    'Báo nhân viên: hoá đơn đã phát hành số, muốn huỷ phải đảo bút toán trong Odoo.'
  );
}
