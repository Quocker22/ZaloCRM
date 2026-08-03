// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: tool tra_danh_muc.
//
// Tool này sinh ra từ bug thật 2026-07-30: khách hỏi "bên bạn có những sản phẩm
// nào" thì bot đoán từ khoá 3 lần rồi chuyển sale, vì KHÔNG có tool nào trả lời
// được câu hỏi mở. Test ở đây chốt: chỉ nêu hàng CÓ GIÁ, gộp đúng nhóm, và không
// bao giờ đọc giá vốn.
import { describe, it, expect, vi } from 'vitest';
import {
  traDanhMuc,
  dinhDangDanhMuc,
} from '../../../src/modules/ai/odoo/tools/tra-danh-muc.js';

/** Odoo giả — tôn trọng điều kiện list_price trong domain như server thật. */
const fakeOdoo = (rows: Record<string, unknown>[]) => ({
  searchRead: vi.fn(async (_m: string, domain: unknown[]) => {
    const dk = (domain as unknown[]).filter(
      (d): d is [string, string, number] => Array.isArray(d) && d[0] === 'list_price',
    );
    return rows.filter((r) =>
      dk.every(([, op, n]) => {
        const g = Number(r.list_price ?? 0);
        return op === '>' ? g > n : g <= n;
      }),
    );
  }),
});

const sp = (nhom: string, gia: number, ten = 'SP') => ({
  name: ten,
  categ_id: [1, nhom],
  list_price: gia,
});

describe('traDanhMuc — gộp nhóm', () => {
  it('gộp theo categ_id và đếm đúng số mặt hàng', async () => {
    const odoo = fakeOdoo([
      sp('Nguồn ngoài trời', 250000),
      sp('Nguồn ngoài trời', 265000),
      sp('led trang trí', 220000),
    ]);

    const kq = await traDanhMuc({ odoo });

    expect(kq).toHaveLength(2);
    expect(kq[0]).toMatchObject({ ten: 'Nguồn ngoài trời', soSanPham: 2 });
    expect(kq[1]).toMatchObject({ ten: 'led trang trí', soSanPham: 1 });
  });

  it('sắp nhóm NHIỀU hàng lên trước (khách quan tâm mảng chính)', async () => {
    const odoo = fakeOdoo([
      sp('ít', 1000),
      sp('nhiều', 1000),
      sp('nhiều', 2000),
      sp('nhiều', 3000),
    ]);

    const kq = await traDanhMuc({ odoo });

    expect(kq[0].ten).toBe('nhiều');
  });

  it('nêu tối đa 2 SP ví dụ mỗi nhóm (đủ hình dung, không loãng)', async () => {
    const odoo = fakeOdoo(
      Array.from({ length: 9 }, (_, i) => sp('phụ kiện', 1000 * (i + 1))),
    );

    const kq = await traDanhMuc({ odoo });

    expect(kq[0].viDu).toHaveLength(2);
  });

  it('SP không có categ_id → dồn vào "Khác", KHÔNG rơi mất', async () => {
    const odoo = fakeOdoo([{ name: 'SP lẻ', list_price: 5000, categ_id: false }]);

    const kq = await traDanhMuc({ odoo });

    expect(kq[0].ten).toBe('Khác');
  });
});

describe('traDanhMuc — CHỈ hàng có giá thật', () => {
  it('bỏ SP giá 0 (chưa nhập giá)', async () => {
    const odoo = fakeOdoo([sp('A', 0), sp('A', 5000)]);

    const kq = await traDanhMuc({ odoo });

    expect(kq[0].soSanPham).toBe(1);
  });

  it('bỏ SP giá ảo 1đ (placeholder nhập liệu, không phải giá bán)', async () => {
    const odoo = fakeOdoo([sp('A', 1), sp('A', 2), sp('A', 5000)]);

    const kq = await traDanhMuc({ odoo });

    expect(kq[0].soSanPham).toBe(1);
  });

  it('domain lọc list_price > ngưỡng ngay tại DB (không lọc phía JS)', async () => {
    const odoo = fakeOdoo([]);
    await traDanhMuc({ odoo });

    const domain = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(domain).toContain('list_price');
  });
});

describe('traDanhMuc — hàng rào bảo mật + lọc lưu trữ', () => {
  it('KHÔNG BAO GIỜ đọc giá vốn', async () => {
    const odoo = fakeOdoo([]);
    await traDanhMuc({ odoo });

    const fields = odoo.searchRead.mock.calls[0][2] as string[];
    expect(fields).not.toContain('standard_price');
    expect(fields).not.toContain('cost');
  });

  it('lọc hàng lưu trữ ở CẢ HAI cấp (variant + template)', async () => {
    const odoo = fakeOdoo([]);
    await traDanhMuc({ odoo });

    const domain = JSON.stringify(odoo.searchRead.mock.calls[0][1]);
    expect(domain).toContain('"active"');
    expect(domain).toContain('product_tmpl_id.active');
  });

  it('chỉ lấy SP đang bán (sale_ok)', async () => {
    const odoo = fakeOdoo([]);
    await traDanhMuc({ odoo });

    expect(JSON.stringify(odoo.searchRead.mock.calls[0][1])).toContain('sale_ok');
  });
});

describe('traDanhMuc — thu hẹp theo từ khoá', () => {
  it('có tu_khoa → thêm điều kiện name ilike', async () => {
    const odoo = fakeOdoo([]);
    await traDanhMuc({ odoo }, { tu_khoa: 'ngoài trời' });

    expect(JSON.stringify(odoo.searchRead.mock.calls[0][1])).toContain('ngoài trời');
  });

  it('tu_khoa rỗng / toàn khoảng trắng → KHÔNG thêm điều kiện', async () => {
    const odoo = fakeOdoo([]);
    await traDanhMuc({ odoo }, { tu_khoa: '   ' });

    expect(JSON.stringify(odoo.searchRead.mock.calls[0][1])).not.toContain('ilike');
  });
});

describe('dinhDangDanhMuc', () => {
  it('nêu tên nhóm, số mặt hàng và giá ví dụ định dạng VN', async () => {
    const s = dinhDangDanhMuc([
      { ten: 'Nguồn ngoài trời', soSanPham: 12, viDu: [{ ten: 'Nguồn 24V600W', gia: 265000 }] },
    ]);

    expect(s).toContain('Nguồn ngoài trời');
    expect(s).toContain('12 mặt hàng');
    expect(s).toContain('265.000đ');
  });

  it('BẢO model đừng chuyển sale — đó chính là bug đang vá', async () => {
    const s = dinhDangDanhMuc([
      { ten: 'A', soSanPham: 1, viDu: [{ ten: 'x', gia: 1000 }] },
    ]);

    expect(s).toContain('ĐỪNG chuyển sale');
  });

  it('rỗng → hướng model gọi lại KHÔNG có tu_khoa, không bỏ cuộc', () => {
    const s = dinhDangDanhMuc([]);

    expect(s).toContain('KHÔNG có tu_khoa');
  });
});
