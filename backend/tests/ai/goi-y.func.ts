// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: logic gợi ý @khách / #sản-phẩm cho ô soạn tin.
import { describe, it, expect, vi } from 'vitest';
import {
  timKhachGoiY, timSanPhamGoiY, KY_TU_TOI_THIEU,
} from '../../src/modules/ai/goi-y-tra.js';

const KHACH = [
  { id: 3898, name: 'Quảng Cáo Hoàng Anh', ref: 'KH003159', phone: false, mobile: false,
    incokit_receivable_balance: 6114000 },
];
const SP_CO_GIA = [
  { id: 715, name: 'Nguồn ATX 12V400W Pro', default_code: '12v400 pro',
    list_price: 195000, uom_id: [1, 'Cái'] },
];
const SP_TRONG_GIA = [
  { id: 194, name: 'Led hắt 3 bóng 7 màu', default_code: 'SP000754',
    list_price: 0, uom_id: [1, 'Bóng'] },
];

/** Odoo giả — phân biệt truy vấn có-giá với trống-giá qua domain. */
const fake = (coGia: unknown[] = [], trongGia: unknown[] = []) => ({
  searchRead: vi.fn(async (_m: string, domain: unknown[]) => {
    const d = JSON.stringify(domain);
    if (d.includes('res.partner') || d.includes('customer_rank')) return KHACH;
    if (d.includes('">",10')) return coGia;
    if (d.includes('"<=",10')) return trongGia;
    return coGia;
  }),
});

describe('timKhachGoiY', () => {
  it('trả tên, mã KH và CÔNG NỢ (API nội bộ, nhân viên cần thấy)', async () => {
    const kq = await timKhachGoiY(fake() as never, 'Quảng Cáo');

    expect(kq[0]).toMatchObject({ id: 3898, ten: 'Quảng Cáo Hoàng Anh', congNo: 6114000 });
  });

  it('query TOÀN SỐ → tra theo SĐT, không tra tên', async () => {
    const o = fake();
    await timKhachGoiY(o as never, '0976938380');

    const domain = JSON.stringify(o.searchRead.mock.calls[0][1]);
    expect(domain).toContain('phone');
    expect(domain).toContain('mobile');
    expect(domain).not.toContain('name');
  });

  it('query CÓ CHỮ → tra theo tên và mã KH', async () => {
    const o = fake();
    await timKhachGoiY(o as never, 'Hoàng Anh');

    const domain = JSON.stringify(o.searchRead.mock.calls[0][1]);
    expect(domain).toContain('name');
    expect(domain).toContain('ref');
  });

  it('chỉ lấy khách hàng (customer_rank > 0)', async () => {
    const o = fake();
    await timKhachGoiY(o as never, 'abc');

    expect(JSON.stringify(o.searchRead.mock.calls[0][1])).toContain('customer_rank');
  });

  it('query ngắn hơn ngưỡng → KHÔNG gọi Odoo', async () => {
    // 1 ký tự khớp cả nghìn bản ghi — tra là phí round-trip.
    const o = fake();
    expect(await timKhachGoiY(o as never, 'a')).toEqual([]);
    expect(o.searchRead).not.toHaveBeenCalled();
  });

  it('query rỗng / toàn khoảng trắng → rỗng', async () => {
    const o = fake();
    expect(await timKhachGoiY(o as never, '   ')).toEqual([]);
    expect(o.searchRead).not.toHaveBeenCalled();
  });

  it('ngưỡng đúng 2 ký tự thì CÓ tra', async () => {
    const o = fake();
    await timKhachGoiY(o as never, 'ab');
    expect(o.searchRead).toHaveBeenCalled();
    expect(KY_TU_TOI_THIEU).toBe(2);
  });
});

describe('timSanPhamGoiY — ƯU TIÊN hàng CÓ GIÁ', () => {
  // 74% catalog trống giá. Lấy theo id thì 8 dòng đầu thường trống hết và gợi ý
  // thành vô dụng — cùng bug đã sửa ở tra-san-pham.ts.

  it('đủ hàng có giá → KHÔNG hỏi thêm hàng trống giá', async () => {
    const day = Array.from({ length: 8 }, (_, i) => ({ ...SP_CO_GIA[0], id: i }));
    const o = fake(day, SP_TRONG_GIA);

    const kq = await timSanPhamGoiY(o as never, 'nguồn');

    expect(kq).toHaveLength(8);
    expect(o.searchRead).toHaveBeenCalledTimes(1);
  });

  it('thiếu hàng có giá → bù bằng hàng trống giá', async () => {
    const o = fake(SP_CO_GIA, SP_TRONG_GIA);

    const kq = await timSanPhamGoiY(o as never, 'led');

    expect(kq).toHaveLength(2);
    expect(kq[0].gia).toBe(195000);   // có giá lên trước
    expect(kq[1].gia).toBe(0);
  });

  it('lọc hàng lưu trữ ở CẢ HAI cấp (variant + template)', async () => {
    const o = fake(SP_CO_GIA);
    await timSanPhamGoiY(o as never, 'led');

    const domain = JSON.stringify(o.searchRead.mock.calls[0][1]);
    expect(domain).toContain('"active"');
    expect(domain).toContain('product_tmpl_id.active');
  });

  it('chỉ lấy SP đang bán', async () => {
    const o = fake(SP_CO_GIA);
    await timSanPhamGoiY(o as never, 'led');

    expect(JSON.stringify(o.searchRead.mock.calls[0][1])).toContain('sale_ok');
  });

  it('tra cả tên lẫn mã sản phẩm', async () => {
    const o = fake(SP_CO_GIA);
    await timSanPhamGoiY(o as never, '12v400');

    const domain = JSON.stringify(o.searchRead.mock.calls[0][1]);
    expect(domain).toContain('name');
    expect(domain).toContain('default_code');
  });

  it('KHÔNG đọc giá vốn', async () => {
    const o = fake(SP_CO_GIA);
    await timSanPhamGoiY(o as never, 'led');

    const fields = o.searchRead.mock.calls[0][2] as string[];
    expect(fields).not.toContain('standard_price');
  });

  it('trả đủ tên, mã, giá, đơn vị để hiện trong gợi ý', async () => {
    const kq = await timSanPhamGoiY(fake(SP_CO_GIA) as never, 'nguồn');

    expect(kq[0]).toMatchObject({
      id: 715, ma: '12v400 pro', gia: 195000, donVi: 'Cái',
    });
  });

  it('query quá ngắn → KHÔNG gọi Odoo', async () => {
    const o = fake(SP_CO_GIA);
    expect(await timSanPhamGoiY(o as never, 'l')).toEqual([]);
    expect(o.searchRead).not.toHaveBeenCalled();
  });
});
