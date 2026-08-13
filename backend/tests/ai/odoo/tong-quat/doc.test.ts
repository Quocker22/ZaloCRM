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

describe('dem_toi_thieu — HAVING phía client (ca "tên trùng nhau" 13/08)', () => {
  const nhomGia = [
    { name: 'Nguyễn Văn A', __count: 3 },
    { name: 'Trần B', __count: 1 },
    { name: 'Lê C', __count: 2 },
    { name: '0974775886', __count: 1 },
  ];
  const odooNhom = () => ({
    searchRead: vi.fn(async () => []),
    execute: vi.fn(async () => nhomGia),
  });

  it('dem_toi_thieu: 2 → chỉ nhóm trùng, sort theo count giảm dần', async () => {
    const { docOdoo } = await import('../../../../src/modules/ai/odoo/tong-quat/doc.js');

    const kq = await docOdoo({ odoo: odooNhom() as never }, {
      bang: 'res.partner', nhom_theo: ['name'], do: ['id'], dem_toi_thieu: 2,
    });

    expect(kq.trangThai).toBe('ok');
    if (kq.trangThai === 'ok') {
      expect(kq.dong.map((d) => d.name)).toEqual(['Nguyễn Văn A', 'Lê C']);
    }
  });

  it('model nhét ["__count",">",1] vào loc → tự rút thành HAVING, domain sạch không nổ', async () => {
    const { docOdoo } = await import('../../../../src/modules/ai/odoo/tong-quat/doc.js');
    const odoo = odooNhom();

    const kq = await docOdoo({ odoo: odoo as never }, {
      bang: 'res.partner', nhom_theo: ['name'], do: ['__count'],
      loc: [['name', '!=', false], ['__count', '>', 1]],
    });

    // Domain gửi Odoo không còn __count.
    const domainGui = odoo.execute.mock.calls[0][2] as unknown[][];
    expect(JSON.stringify(domainGui[0])).not.toContain('__count');
    if (kq.trangThai === 'ok') {
      expect(kq.dong.every((d) => Number(d.__count) >= 2)).toBe(true);
    }
  });

  it('định dạng: "__count" hiện thành "× N", không lộ nhãn kỹ thuật', async () => {
    const { dinhDangDoc } = await import('../../../../src/modules/ai/odoo/tong-quat/doc.js');

    const ra = dinhDangDoc({ trangThai: 'ok', soDong: 1, dong: [{ name: 'Nguyễn Văn A', __count: 3 }] } as never);

    expect(ra).toContain('× 3');
    expect(ra).not.toContain('__count=');
  });
});

describe('nhãn cột tiếng người — không lộ "name=" ra Zalo', () => {
  it('name tự đứng, __count → × N, cột quen → nhãn Việt', async () => {
    const { dinhDangDoc } = await import('../../../../src/modules/ai/odoo/tong-quat/doc.js');
    const ra = dinhDangDoc({
      trangThai: 'ok', soDong: 2,
      dong: [
        { name: 'anh du', __count: 5 },
        { name: 'Đèn P10', price_total: 12500000, product_uom_qty: 40 },
      ],
    } as never);
    expect(ra).toContain('- anh du · × 5');
    expect(ra).toContain('- Đèn P10 · doanh thu 12.500.000 · SL 40');
    expect(ra).not.toMatch(/name=|price_total|product_uom_qty/);
  });

  it('cột lạ: fallback bỏ _id + gạch dưới, nhom_theo "date:month" tra gốc', async () => {
    const { dinhDangDoc } = await import('../../../../src/modules/ai/odoo/tong-quat/doc.js');
    const ra = dinhDangDoc({
      trangThai: 'ok', soDong: 1,
      dong: [{ 'date:month': 'tháng 8 2026', warehouse_id: [3, 'Kho HN'] }],
    } as never);
    expect(ra).toContain('ngày tháng 8 2026');
    expect(ra).toContain('warehouse Kho HN');
    expect(ra).not.toContain('warehouse_id');
  });
});
