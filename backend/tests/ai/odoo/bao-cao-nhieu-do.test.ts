// SPDX-License-Identifier: AGPL-3.0-or-later
// Bug thật 20:08 10/08: "chi tiết từng sản phẩm" → bot chọn do=so_luong nên
// bảng chỉ có SỐ LƯỢNG, không có TIỀN. Nhân viên cần cả hai; và dòng "VAT 8%:
// 5.923.520" lộ ra rằng số tiền bị đọc nhầm thành số lượng.
//
// Tool chỉ đo được MỘT chỉ tiêu/lần → giờ cho phép nhiều.
import { describe, it, expect, vi } from 'vitest';
import { baoCaoLinhHoat, baoCaoLinhHoatDefinition, dinhDangLinhHoat }
  from '../../../src/modules/ai/odoo/tools/bao-cao-linh-hoat.js';

const fakeOdoo = (rows: unknown[]) => ({
  searchRead: vi.fn(async () => rows),
  execute: vi.fn(async () => rows),
});

describe('bao_cao_linh_hoat — đo nhiều chỉ tiêu', () => {
  it('do="so_luong,tong_tien" → bảng có CẢ số lượng lẫn tiền', async () => {
    const odoo = fakeOdoo([
      { product_id: [1, 'Nguồn NB 12V300W'], product_uom_qty: 120, price_total: 15120000 },
    ]);
    const kq = await baoCaoLinhHoat({ odoo } as never, {
      bang: 'dong_don', do: 'so_luong,tong_tien', nhom_theo: 'san_pham',
      tu_ngay: '2026-08-01', den_ngay: '2026-08-31',
    });
    const s = dinhDangLinhHoat(kq);
    expect(s).toContain('120');
    expect(s).toContain('15.120.000');
  });

  it('một chỉ tiêu vẫn chạy như cũ (tương thích ngược)', async () => {
    const odoo = fakeOdoo([{ product_id: [1, 'X'], product_uom_qty: 5 }]);
    const kq = await baoCaoLinhHoat({ odoo } as never, {
      bang: 'dong_don', do: 'so_luong', nhom_theo: 'san_pham',
      tu_ngay: '2026-08-01', den_ngay: '2026-08-31',
    });
    expect(dinhDangLinhHoat(kq)).toContain('5');
  });

  it('mô tả tool dặn dùng nhiều chỉ tiêu khi hỏi "chi tiết"', () => {
    expect(baoCaoLinhHoatDefinition.description).toContain('so_luong,tong_tien');
  });
});
