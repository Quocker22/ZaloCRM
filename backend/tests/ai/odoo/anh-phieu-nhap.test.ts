// SPDX-License-Identifier: AGPL-3.0-or-later
// CA 16/08 — ảnh phiếu nhập TỰ VẼ + link phiếu dạng /web# (anh Quốc: "ủa
// phiếu này đâu phải phiếu custom của tôi", "link .../vi/odoo/purchase/14592
// cũng sai nhé"). Prod không có report custom cho purchase → tự vẽ bằng
// anh-bang; link mirror đơn bán với action 482 "Danh sách phiếu nhập".
import { describe, it, expect } from 'vitest';
import { vePhieuNhapSvg } from '../../../src/modules/ai/odoo/anh-phieu-nhap.js';
import { linkXuLyDonMua } from '../../../src/modules/ai/odoo/hoa-don-anh.js';

describe('linkXuLyDonMua — dạng /web# như đơn bán, hết /odoo/purchase hỏng', () => {
  it('mặc định action 482, không còn đường /odoo/purchase', () => {
    const link = linkXuLyDonMua('https://led.incokit.com/', 14592);
    expect(link).toContain('/web#id=14592');
    expect(link).toContain('action=482');
    expect(link).toContain('model=purchase.order');
    expect(link).not.toContain('/odoo/purchase');
  });
});

describe('gonTen — tên dài không được tràn đè cột (nhìn ảnh thật P04528)', () => {
  it('bỏ tiền tố [mã], cắt ranh giới từ + dấu …', async () => {
    const { gonTen } = await import('../../../src/modules/ai/odoo/anh-phieu-nhap.js');
    expect(gonTen('[NB12V400W] Nguồn NB Ngoài Trời 12V400W (cái)')).toBe('Nguồn NB Ngoài Trời 12V400W (cái)');
    // bỏ [mã] xong vừa cột thì giữ nguyên, không thêm dấu … thừa
    expect(gonTen('[led dây chữ S 6ml 120 led 1m hồng] led dây chữ S 6mm 120 led 1m hồng (mét)'))
      .toBe('led dây chữ S 6mm 120 led 1m hồng (mét)');
    // còn tên thật sự dài thì cắt ở ranh giới từ + dấu …
    const dai = gonTen('Nguồn Rong ElectricTrong Nhà 5V60A Mỏng Có Quạt Chống Nước IP67 (cái)');
    expect(dai.length).toBeLessThanOrEqual(41);
    expect(dai.endsWith('…')).toBe(true);
  });
});


describe('vePhieuNhapSvg — dáng CHỨNG TỪ, không phải bảng trần (góp ý 2 của anh Quốc)', () => {
  const svg = vePhieuNhapSvg({
    ma: 'P04529', ngay: '2026-08-16',
    ncc: { ten: 'Trung Quốc', sdt: '090xxx' },
    congTy: { ten: 'LEDNELIA Việt Nam', diaChi: '34A đường 2 ngõ 3, Hà Nội', sdt: '0903436400' },
    dong: [
      { ten: 'p10 full out LLR 260330', sl: 10000, gia: 164640, thanhTien: 1646400000 },
      { ten: '[NB12V400W] Nguồn NB Ngoài Trời 12V400W (cái)', sl: 3030, gia: 0, thanhTien: 0 },
    ],
  });
  it('đầu phiếu đủ: tên shop + địa chỉ + SĐT, mã phiếu, ngày, NCC', () => {
    expect(svg).toContain('LEDNELIA Việt Nam');
    expect(svg).toContain('34A đường 2 ngõ 3');
    expect(svg).toContain('0903436400');
    expect(svg).toContain('PHIẾU NHẬP HÀNG P04529');
    expect(svg).toContain('NCC: Trung Quốc');
    expect(svg).toContain('2026-08-16');
  });
  it('bảng: dòng chưa giá ghi "chưa có", tổng đúng, tên bỏ [mã]', () => {
    expect(svg).toContain('chưa có');
    expect(svg).toContain('1.646.400.000đ');
    expect(svg).not.toContain('[NB12V400W]');
    expect(svg).toContain('Nguồn NB Ngoài Trời 12V400W (cái)');
  });
});
