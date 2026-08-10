// SPDX-License-Identifier: AGPL-3.0-or-later
// doc_odoo — đọc bất cứ gì. Sinh từ câu thật 17:52 10/08: "doanh số chi tiết
// theo từng sản phẩm" mà bot chịu vì bao_cao_linh_hoat chỉ có vài bảng khai sẵn.
import { describe, it, expect, vi } from 'vitest';
import { docOdoo, docOdooDefinition, dinhDangDoc }
  from '../../../../src/modules/ai/odoo/tong-quat/doc.js';

const fake = (rows: unknown[] = []) => ({
  searchRead: vi.fn(async () => rows),
  execute: vi.fn(async () => rows),
});

describe('docOdoo', () => {
  it('đọc thường → search_read', async () => {
    const odoo = fake([{ id: 1, name: 'SP A' }]);
    const kq = await docOdoo({ odoo } as never,
      { bang: 'product.product', cot: ['id', 'name'], gioi_han: 5 });
    expect(kq).toEqual({ trangThai: 'ok', dong: [{ id: 1, name: 'SP A' }], soDong: 1 });
    expect(odoo.searchRead).toHaveBeenCalled();
  });

  it('xin cột CẤM → lỗi rõ ràng, KHÔNG gọi Odoo', async () => {
    const odoo = fake();
    const kq = await docOdoo({ odoo } as never,
      { bang: 'product.product', cot: ['name', 'standard_price'] });
    expect(kq.trangThai).toBe('loi');
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('standard_price');
    expect(odoo.searchRead).not.toHaveBeenCalled();
  });

  it('có nhom_theo → read_group (báo cáo gộp)', async () => {
    const odoo = fake([{ product_id: [1, 'SP A'], price_total: 39035000 }]);
    const kq = await docOdoo({ odoo } as never, {
      bang: 'sale.report', nhom_theo: ['product_id'], do: ['price_total'],
      loc: [['partner_id', '=', 76]],
    });
    expect(kq.trangThai).toBe('ok');
    const [model, method] = odoo.execute.mock.calls[0];
    expect(model).toBe('sale.report');
    expect(method).toBe('read_group');
  });

  it('cột cấm trong "do" cũng bị chặn', async () => {
    const odoo = fake();
    const kq = await docOdoo({ odoo } as never,
      { bang: 'sale.report', nhom_theo: ['product_id'], do: ['margin'] });
    expect(kq.trangThai).toBe('loi');
    expect(odoo.execute).not.toHaveBeenCalled();
  });

  it('thiếu bảng → lỗi, không gọi Odoo', async () => {
    const odoo = fake();
    expect((await docOdoo({ odoo } as never, { bang: '' })).trangThai).toBe('loi');
    expect(odoo.searchRead).not.toHaveBeenCalled();
  });

  it('giới hạn trần 200 dòng — không nhét cả nghìn dòng vào ngữ cảnh LLM', async () => {
    const odoo = fake([]);
    await docOdoo({ odoo } as never, { bang: 'res.partner', gioi_han: 9999 });
    const opts = odoo.searchRead.mock.calls[0][3] as { limit: number };
    expect(opts.limit).toBe(200);
  });

  it('Odoo ném → trả lỗi kèm thông điệp, không nuốt im', async () => {
    const odoo = { searchRead: vi.fn(async () => { throw new Error('bảng lạ'); }), execute: vi.fn() };
    const kq = await docOdoo({ odoo } as never, { bang: 'khong.co' });
    expect(kq.trangThai).toBe('loi');
    if (kq.trangThai === 'loi') expect(kq.lyDo).toContain('bảng lạ');
  });

  it('mô tả tool nêu rõ dùng khi nào', () => {
    expect(docOdooDefinition.name).toBe('doc_odoo');
    expect(docOdooDefinition.description).toContain('doanh số');
  });

  it('rỗng nói "không có dữ liệu", KHÔNG nói lỗi', () => {
    const s = dinhDangDoc({ trangThai: 'ok', dong: [], soDong: 0 });
    expect(s.toLowerCase()).toContain('không có dữ liệu');
    expect(s.toLowerCase()).not.toContain('lỗi');
  });
});
