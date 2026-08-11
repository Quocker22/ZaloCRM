// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: tra thuế VAT động từ account.tax.
//
// Vì sao KHÔNG hard-code id=4 dù đo prod thấy "VAT 8%" đang là id=4: id là cấu
// hình của Odoo, không phải hằng số của nghiệp vụ. Đổi công ty / nhân bản DB /
// sửa danh mục thuế là id đổi — lúc đó bot ghi im lặng vào một dòng thuế khác
// mà không ai biết. Tra theo (type_tax_use='sale' + amount) thì sai cấu hình sẽ
// lộ ra ngay bằng lỗi "không tìm thấy", không âm thầm ghi sai sổ.
import { describe, it, expect, vi } from 'vitest';
import { traThueBan, xoaCacheThue } from '../../../src/modules/ai/odoo/tools/tra-thue.js';

/** Danh mục thuế THẬT đo trên prod LEDNELIA VN 11/08/2026. */
const THUE_PROD = [
  { id: 3, name: 'VAT 4%', amount: 4, type_tax_use: 'sale' },
  { id: 4, name: 'VAT 8%', amount: 8, type_tax_use: 'sale' },
  { id: 5, name: 'VAT 10%', amount: 10, type_tax_use: 'sale' },
  { id: 6, name: '0%', amount: 0, type_tax_use: 'sale' },
];

function fakeOdoo(rows = THUE_PROD) {
  return {
    searchRead: vi.fn(async (model: string, domain: unknown[]) => {
      if (model !== 'account.tax') return [];
      // Bắt chước Odoo: lọc theo domain amount + type_tax_use.
      const s = JSON.stringify(domain);
      return rows.filter((t) => s.includes(`,${t.amount}]`) || s.includes(`, ${t.amount}]`));
    }),
    execute: vi.fn(async () => true),
  };
}

describe('traThueBan — tra động, không hard-code id', () => {
  it('8% → đúng dòng thuế VAT 8% của prod (id=4), tra bằng amount chứ không bằng id', async () => {
    xoaCacheThue();
    const odoo = fakeOdoo();

    const t = await traThueBan({ odoo }, 8);

    expect(t).toEqual({ id: 4, ten: 'VAT 8%', phanTram: 8 });
    // Phải tra account.tax với type_tax_use='sale': thuế MUA (purchase) cùng
    // 8% cũng tồn tại, ghi nhầm vào đơn bán là sai tài khoản kế toán.
    const domain = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(domain).toContain('type_tax_use');
    expect(domain).toContain('sale');
  });

  it('10% → id=5 (nhân viên nói "VAT 10%")', async () => {
    xoaCacheThue();
    const t = await traThueBan({ odoo: fakeOdoo() }, 10);
    expect(t?.id).toBe(5);
  });

  it('KHÔNG có thuế khớp (vd 5%) → trả null để caller BÁO nhân viên, không im lặng', async () => {
    // Đo prod: danh mục chỉ có 0/4/8/10%. Nhân viên nói "VAT 5%" là ca thật sẽ
    // xảy ra. Im lặng bỏ VAT = đơn thiếu thuế = sai sổ sách.
    xoaCacheThue();
    const t = await traThueBan({ odoo: fakeOdoo() }, 5);
    expect(t).toBeNull();
  });

  it('CACHE: tra 2 lần cùng % chỉ gọi Odoo MỘT lần', async () => {
    xoaCacheThue();
    const odoo = fakeOdoo();

    await traThueBan({ odoo }, 8);
    await traThueBan({ odoo }, 8);

    expect(odoo.searchRead).toHaveBeenCalledTimes(1);
  });

  it('Odoo lỗi → null, KHÔNG ném (không được làm sập luồng lên đơn)', async () => {
    xoaCacheThue();
    const odoo = {
      searchRead: vi.fn(async () => { throw new Error('XML-RPC sập'); }),
      execute: vi.fn(async () => true),
    };
    await expect(traThueBan({ odoo }, 8)).resolves.toBeNull();
  });
});
