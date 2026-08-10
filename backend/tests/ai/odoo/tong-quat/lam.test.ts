// SPDX-License-Identifier: AGPL-3.0-or-later
// lam_odoo — GHI vào Odoo. Đây là tool nguy hiểm nhất hệ thống: user bot có 20
// nhóm quyền trên Odoo (bán hàng, kho, mua, kế toán) nên Odoo KHÔNG chặn giúp.
// Hai phanh phải chứng minh được bằng test, không phải bằng lời hứa.
import { describe, it, expect, vi } from 'vitest';
import { lamOdoo, dinhDangLam } from '../../../../src/modules/ai/odoo/tong-quat/lam.js';

function fake(soKhop = 1) {
  const searchRead = vi.fn(async () => Array.from({ length: soKhop }, (_, i) => ({ id: i + 1 })));
  const execute = vi.fn(async (_m: string, method: string) =>
    (method === 'search_count' ? soKhop : true));
  return { searchRead, execute };
}

describe('lamOdoo — ghi thường thì làm luôn', () => {
  it('xác nhận đơn → chạy NGAY, không hỏi (anh Quốc chốt 10/08)', async () => {
    const odoo = fake(1);
    const kq = await lamOdoo({ odoo } as never,
      { bang: 'sale.order', viec: 'goi_nut', nut: 'action_confirm', loc: [['name', '=', 'S13823']] });
    expect(kq.trangThai).toBe('da_lam');
    expect(odoo.execute.mock.calls.some((c) => c[1] === 'action_confirm')).toBe(true);
  });

  it('tạo bản ghi mới → create', async () => {
    const odoo = fake(0);
    const kq = await lamOdoo({ odoo } as never,
      { bang: 'res.partner', viec: 'tao', du_lieu: { name: 'Khách X' } });
    expect(kq.trangThai).toBe('da_lam');
    expect(odoo.execute.mock.calls.some((c) => c[1] === 'create')).toBe(true);
  });

  it('sửa 1 bản ghi → write', async () => {
    const odoo = fake(1);
    const kq = await lamOdoo({ odoo } as never,
      { bang: 'product.template', viec: 'sua', loc: [['id', '=', 5]], du_lieu: { list_price: 99000 } });
    expect(kq.trangThai).toBe('da_lam');
    expect(odoo.execute.mock.calls.some((c) => c[1] === 'write')).toBe(true);
  });
});

describe('lamOdoo — PHANH', () => {
  it('unlink → can_xac_nhan, TUYỆT ĐỐI không gọi lệnh xoá', async () => {
    const odoo = fake(47);
    const kq = await lamOdoo({ odoo } as never,
      { bang: 'sale.order', viec: 'goi_nut', nut: 'unlink', loc: [['state', '=', 'draft']] });
    expect(kq.trangThai).toBe('can_xac_nhan');
    if (kq.trangThai === 'can_xac_nhan') {
      expect(kq.lyDo).toBe('xoa');
      expect(kq.soBanGhi).toBe(47);
      expect(kq.moTa).toContain('47');
    }
    expect(odoo.execute.mock.calls.some((c) => c[1] === 'unlink')).toBe(false);
  });

  it('sửa 21 bản ghi → xin xác nhận; 20 → chạy', async () => {
    const nhieu = fake(21);
    const kq1 = await lamOdoo({ odoo: nhieu } as never,
      { bang: 'product.product', viec: 'sua', loc: [['id', '>', 0]], du_lieu: { list_price: 1 } });
    expect(kq1.trangThai).toBe('can_xac_nhan');
    expect(nhieu.execute.mock.calls.some((c) => c[1] === 'write')).toBe(false);

    const vua = fake(20);
    const kq2 = await lamOdoo({ odoo: vua } as never,
      { bang: 'product.product', viec: 'sua', loc: [['id', '>', 0]], du_lieu: { list_price: 1 } });
    expect(kq2.trangThai).toBe('da_lam');
  });

  it('xác nhận rồi → chạy thật', async () => {
    const odoo = fake(47);
    const kq = await lamOdoo({ odoo } as never, {
      bang: 'sale.order', viec: 'goi_nut', nut: 'unlink',
      loc: [['state', '=', 'draft']], xac_nhan: true,
    });
    expect(kq.trangThai).toBe('da_lam');
    expect(odoo.execute.mock.calls.some((c) => c[1] === 'unlink')).toBe(true);
  });

  it('sửa/gọi nút KHÔNG có loc → lỗi (chống đụng cả bảng)', async () => {
    const odoo = fake(999);
    const kq = await lamOdoo({ odoo } as never,
      { bang: 'sale.order', viec: 'sua', du_lieu: { note: 'x' } });
    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
  });

  it('lọc không khớp bản ghi nào → lỗi rõ, không gọi ghi', async () => {
    const odoo = fake(0);
    const kq = await lamOdoo({ odoo } as never,
      { bang: 'sale.order', viec: 'goi_nut', nut: 'action_confirm', loc: [['name', '=', 'KHONG_CO']] });
    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute.mock.calls.some((c) => c[1] === 'action_confirm')).toBe(false);
  });

  it('lỗi "cannot marshal None" của Odoo → vẫn tính là ĐÃ LÀM', async () => {
    const odoo = {
      searchRead: vi.fn(async () => [{ id: 1 }]),
      execute: vi.fn(async (_m: string, method: string) => {
        if (method === 'search_count') return 1;
        throw new Error('TypeError: cannot marshal None unless allow_none is enabled');
      }),
    };
    const kq = await lamOdoo({ odoo } as never,
      { bang: 'sale.order', viec: 'goi_nut', nut: 'action_confirm', loc: [['id', '=', 1]] });
    expect(kq.trangThai).toBe('da_lam');
  });

  it('dinhDangLam nêu rõ số bản ghi khi xin xác nhận', () => {
    const s = dinhDangLam({ trangThai: 'can_xac_nhan', lyDo: 'xoa', soBanGhi: 47, moTa: 'sẽ xoá 47 đơn nháp' });
    expect(s).toContain('47');
    expect(s.toLowerCase()).toContain('xác nhận');
  });
});
