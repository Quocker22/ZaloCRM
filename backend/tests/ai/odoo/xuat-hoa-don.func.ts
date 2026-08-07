// SPDX-License-Identifier: AGPL-3.0-or-later
// Tool xuat_hoa_don — XUẤT HOÁ ĐƠN KẾ TOÁN chính thức (account.move, vào sổ).
// Anh chốt 07/08: POST luôn lấy số phát hành, không để nháp.
//
// KHÁC gui_hoa_don (chỉ render ẢNH báo giá, không ghi gì). Đây là tool GHI
// ERP nặng nhất của bot: xác nhận đơn + tạo hoá đơn + vào sổ — nên idempotent
// là hợp đồng số 1: đơn đã có hoá đơn thì trả lại cái cũ, không xuất đôi.
import { describe, it, expect, vi } from 'vitest';
import {
  xuatHoaDon, xuatHoaDonDefinition, dinhDangXuatHoaDon,
} from '../../../src/modules/ai/odoo/tools/xuat-hoa-don.js';
import { guiHoaDonDefinition } from '../../../src/modules/ai/odoo/tools/gui-hoa-don.js';
import { buildStaffRegistry } from '../../../src/modules/ai/agent/staff-agent.js';
import { buildCustomerRegistry } from '../../../src/modules/ai/agent/customer-agent.js';
import type { OdooClient } from '../../../src/modules/ai/odoo/client.js';

const DON_NHAP = {
  id: 26728, name: 'S13811', state: 'draft', amount_total: 780000,
  partner_id: [1894, 'A Tuấn Tospino'], invoice_ids: [] as number[],
};

/**
 * Odoo giả có trạng thái: theo dõi action_confirm / wizard / action_post.
 * `hoaDonSan` = hoá đơn đã tồn tại sẵn trên đơn (test idempotent).
 */
function fakeOdoo(don = { ...DON_NHAP }, hoaDonSan?: { id: number; name: string; state: string }) {
  const goi: Array<{ model: string; method: string; args: unknown[]; kwargs?: Record<string, unknown> }> = [];
  const hoaDon = hoaDonSan ? { ...hoaDonSan, amount_total: don.amount_total, move_type: 'out_invoice' } : null;
  const trangThai = { don, hoaDon, wizardTao: false };
  if (hoaDon) don.invoice_ids = [hoaDon.id];

  const searchRead = vi.fn(async (model: string, domain: unknown[]) => {
    if (model === 'sale.order') {
      const dk = domain.find((d): d is unknown[] => Array.isArray(d));
      if (!dk) return [];
      if (dk[0] === 'id' && Number(dk[2]) !== trangThai.don.id) return [];
      if (dk[0] === 'name' && dk[2] !== trangThai.don.name) return [];
      return [{ ...trangThai.don }];
    }
    if (model === 'account.move') {
      return trangThai.hoaDon ? [{ ...trangThai.hoaDon }] : [];
    }
    return [];
  });

  const execute = vi.fn(async (model: string, method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}) => {
    goi.push({ model, method, args, kwargs });
    if (model === 'sale.order' && method === 'action_confirm') {
      trangThai.don.state = 'sale';
      return true;
    }
    if (model === 'sale.advance.payment.inv' && method === 'create') return 901;
    if (model === 'sale.advance.payment.inv' && method === 'create_invoices') {
      trangThai.hoaDon = { id: 7001, name: '/', state: 'draft', amount_total: trangThai.don.amount_total, move_type: 'out_invoice' };
      trangThai.don.invoice_ids = [7001];
      return true;
    }
    if (model === 'account.move' && method === 'action_post') {
      if (!trangThai.hoaDon) throw new Error('không có hoá đơn để post');
      trangThai.hoaDon.state = 'posted';
      trangThai.hoaDon.name = 'INV/2026/00042';
      return true;
    }
    throw new Error(`fake odoo không biết ${model}.${method}`);
  });

  return { searchRead, execute, goi, trangThai };
}

const deps = (odoo: ReturnType<typeof fakeOdoo>) => ({
  odoo: odoo as unknown as Pick<OdooClient, 'searchRead' | 'execute'>,
  odooUrl: 'https://led.incokit.com',
  conversationId: 'conv-1',
});

describe('xuatHoaDon — đường vàng: đơn nháp → xác nhận → tạo → VÀO SỔ', () => {
  it('đủ 4 bước, trả số hoá đơn chính thức + link account.move', async () => {
    const odoo = fakeOdoo();
    const kq = await xuatHoaDon(deps(odoo), { ma_don: 'S13811' });

    expect(kq.trangThai).toBe('da_xuat');
    if (kq.trangThai !== 'da_xuat') return;
    expect(kq.soHoaDon).toBe('INV/2026/00042');
    expect(kq.maDon).toBe('S13811');
    expect(kq.link).toContain('model=account.move');
    expect(kq.link).toContain('id=7001');

    const thuTu = odoo.goi.map((g) => `${g.model}.${g.method}`);
    expect(thuTu).toEqual([
      'sale.order.action_confirm',
      'sale.advance.payment.inv.create',
      'sale.advance.payment.inv.create_invoices',
      'account.move.action_post',
    ]);
    // Wizard phải biết đơn nào — qua context active_ids, không đoán.
    const taoWizard = odoo.goi[1];
    expect((taoWizard.kwargs?.context as Record<string, unknown>)?.active_ids).toEqual([26728]);
  });

  it('đơn ĐÃ sale (không draft) → bỏ qua action_confirm, vẫn xuất được', async () => {
    const odoo = fakeOdoo({ ...DON_NHAP, state: 'sale' });
    const kq = await xuatHoaDon(deps(odoo), { don_id: 26728 });
    expect(kq.trangThai).toBe('da_xuat');
    expect(odoo.goi.map((g) => g.method)).not.toContain('action_confirm');
  });
});

describe('idempotent — KHÔNG BAO GIỜ xuất đôi', () => {
  it('đơn đã có hoá đơn POSTED → trả da_co_truoc, không gọi wizard', async () => {
    const odoo = fakeOdoo({ ...DON_NHAP, state: 'sale' }, { id: 7009, name: 'INV/2026/00007', state: 'posted' });
    const kq = await xuatHoaDon(deps(odoo), { ma_don: 'S13811' });
    expect(kq.trangThai).toBe('da_co_truoc');
    if (kq.trangThai !== 'da_co_truoc') return;
    expect(kq.soHoaDon).toBe('INV/2026/00007');
    expect(odoo.goi.map((g) => g.method)).not.toContain('create_invoices');
  });

  it('đơn có hoá đơn NHÁP bỏ dở → chỉ post nốt, không tạo thêm', async () => {
    const odoo = fakeOdoo({ ...DON_NHAP, state: 'sale' }, { id: 7010, name: '/', state: 'draft' });
    const kq = await xuatHoaDon(deps(odoo), { ma_don: 'S13811' });
    expect(kq.trangThai).toBe('da_xuat');
    const thuTu = odoo.goi.map((g) => `${g.model}.${g.method}`);
    expect(thuTu).toEqual(['account.move.action_post']);
  });
});

describe('lỗi phải rõ ràng, không nuốt', () => {
  it('không tìm thấy đơn → loi kèm hướng dẫn', async () => {
    const odoo = fakeOdoo();
    const kq = await xuatHoaDon(deps(odoo), { ma_don: 'S99999' });
    expect(kq.trangThai).toBe('loi');
  });

  it('Odoo ném khi tạo hoá đơn (nothing to invoice) → loi mang thông điệp Odoo', async () => {
    const odoo = fakeOdoo({ ...DON_NHAP, state: 'sale' });
    odoo.execute.mockImplementationOnce(async () => 901) // wizard create
      .mockImplementationOnce(async () => { throw new Error('There is nothing to invoice!'); });
    const kq = await xuatHoaDon(deps(odoo), { don_id: 26728 });
    expect(kq.trangThai).toBe('loi');
    if (kq.trangThai !== 'loi') return;
    expect(kq.lyDo).toContain('nothing to invoice');
  });
});

describe('nói trống — lấy đơn mới nhất của hội thoại (như gui_hoa_don)', () => {
  it('không mã/id → tra client_order_ref like zalo:<conv>:%', async () => {
    const odoo = fakeOdoo();
    odoo.searchRead.mockImplementationOnce(async (model: string, domain: unknown[]) => {
      expect(model).toBe('sale.order');
      expect(JSON.stringify(domain)).toContain('zalo:conv-1:');
      return [{ ...DON_NHAP }];
    });
    const kq = await xuatHoaDon(deps(odoo), {});
    expect(kq.trangThai).toBe('da_xuat');
  });
});

describe('ranh giới + mô tả tool', () => {
  it('registry KHÁCH tuyệt đối không có xuat_hoa_don', () => {
    const r = buildCustomerRegistry({
      odoo: fakeOdoo() as unknown as OdooClient,
      ghiNhanChuyenSale: async () => {},
    });
    expect(r.definitions().map((d) => d.name)).not.toContain('xuat_hoa_don');
  });

  it('registry NHÂN VIÊN có xuat_hoa_don khi đủ odooUrl', () => {
    const r = buildStaffRegistry({
      odoo: fakeOdoo() as unknown as OdooClient,
      conversationId: 'conv-1',
      seq: 1,
      odooUrl: 'https://led.incokit.com',
      ghiNhanChuyenSale: async () => {},
    });
    expect(r.definitions().map((d) => d.name)).toContain('xuat_hoa_don');
  });

  it('cụm "xuất hóa đơn" thuộc về xuat_hoa_don, KHÔNG còn ở gui_hoa_don (tránh model nhầm)', () => {
    expect(xuatHoaDonDefinition.description).toContain('xuất hóa đơn');
    expect(xuatHoaDonDefinition.mutates).toBe(true);
    expect(guiHoaDonDefinition.description).not.toContain('"xuất hóa đơn"');
  });

  it('dinhDangXuatHoaDon nêu số HĐ + cảnh báo đã vào sổ chính thức', () => {
    const s = dinhDangXuatHoaDon({
      trangThai: 'da_xuat', hoaDonId: 7001, soHoaDon: 'INV/2026/00042',
      maDon: 'S13811', tenKhach: 'A Tuấn Tospino', tongTien: 780000,
      link: 'https://led.incokit.com/web#id=7001',
    });
    expect(s).toContain('INV/2026/00042');
    expect(s).toContain('780.000');
    expect(s.toLowerCase()).toContain('chính thức');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bug thật 23:33 07/08 (S13815): Odoo chạy XONG action nhưng trả None →
// XML-RPC ném 'cannot marshal None' — đơn đã confirm, hoá đơn đã tạo mà bot
// báo lỗi và bỏ dở (hoá đơn kẹt ở nháp). Action kiểu void phải NUỐT lỗi này
// rồi XÁC MINH bằng đọc lại, không tin giá trị trả về.
describe('lỗi "cannot marshal None" — action đã chạy xong phía server', () => {
  it('mọi action ném marshal-None vẫn đi hết flow, hoá đơn vẫn VÀO SỔ', async () => {
    const odoo = fakeOdoo();
    const goc = odoo.execute.getMockImplementation()!;
    odoo.execute.mockImplementation(async (model: string, method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}) => {
      const kq = await goc(model, method, args, kwargs);
      // Giả lập Odoo thật: action_* làm xong việc rồi mới ném marshal None.
      if (method === 'action_confirm' || method === 'create_invoices' || method === 'action_post') {
        throw new Error('TypeError: cannot marshal None unless allow_none is enabled');
      }
      return kq;
    });
    const kq = await xuatHoaDon(deps(odoo), { ma_don: 'S13811' });
    expect(kq.trangThai).toBe('da_xuat');
    if (kq.trangThai !== 'da_xuat') return;
    expect(kq.soHoaDon).toBe('INV/2026/00042');
  });

  it('lỗi Odoo THẬT (không phải marshal None) vẫn báo lỗi như cũ', async () => {
    const odoo = fakeOdoo({ ...DON_NHAP, state: 'sale' });
    odoo.execute.mockImplementationOnce(async () => { throw new Error('Access Denied'); });
    const kq = await xuatHoaDon(deps(odoo), { don_id: 26728 });
    expect(kq.trangThai).toBe('loi');
  });
});
