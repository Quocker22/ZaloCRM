// SPDX-License-Identifier: AGPL-3.0-or-later
// CA 16/08 — ảnh phiếu nhập TỰ VẼ + link phiếu dạng /web# (anh Quốc: "ủa
// phiếu này đâu phải phiếu custom của tôi", "link .../vi/odoo/purchase/14592
// cũng sai nhé"). Prod không có report custom cho purchase → tự vẽ bằng
// anh-bang; link mirror đơn bán với action 482 "Danh sách phiếu nhập".
import { describe, it, expect } from 'vitest';
import { vePhieuNhapSvg, maTuTen, nhanTrangThai } from '../../../src/modules/ai/odoo/anh-phieu-nhap.js';
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
    expect(gonTen('[NB12V400W] Nguồn NB Ngoài Trời 12V400W (cái)')).toBe('Nguồn NB Ngoài Trời 12V400W');
    // bỏ [mã] xong vừa cột thì giữ nguyên, không thêm dấu … thừa
    expect(gonTen('[led dây chữ S 6ml 120 led 1m hồng] led dây chữ S 6mm 120 led 1m hồng (mét)'))
      .toBe('led dây chữ S 6mm 120 led 1m hồng (mét)');
    // còn tên thật sự dài thì cắt ở ranh giới từ + dấu …
    const dai = gonTen('Nguồn Rong ElectricTrong Nhà 5V60A Mỏng Có Quạt Chống Nước IP67 (cái)');
    expect(dai.length).toBeLessThanOrEqual(41);
    expect(dai.endsWith('…')).toBe(true);
  });
});


describe('vePhieuNhapSvg — bám MẪU app ERP (anh Quốc gửi P04521 làm chuẩn)', () => {
  const svg = vePhieuNhapSvg({
    ma: 'P04530', ngay: '16/08/2026', trangThai: 'Nháp',
    khoNhan: 'Chi nhánh trung tâm', nguoiTao: 'Bot Zalo',
    ncc: { ten: 'Trung Quốc', sdt: '090xxx', diaChi: '' },
    congTy: { ten: 'LEDNELIA Việt Nam', diaChi: '34A đường 2 ngõ 3, Hà Nội', email: 'lednelia@gmail.com' },
    dong: [
      { ma: 'NB12V400W', ten: '[NB12V400W] Nguồn NB Ngoài Trời 12V400W (cái)', dvt: 'Cái', sl: 3030, gia: 0, thanhTien: 0 },
      { ma: '', ten: 'p10 full out LLR 260330', dvt: 'Cái', sl: 10000, gia: 164640, thanhTien: 1646400000 },
    ],
    thue: 252126600,
  });
  it('đủ các khối của mẫu: công ty+email, tiêu đề, Số/Ngày, NCC|Kho|Người tạo|Trạng thái', () => {
    for (const c of ['PHIẾU NHẬP HÀNG', 'P04530', 'LEDNELIA Việt Nam', 'lednelia@gmail.com',
      'Nhà cung cấp', 'Kho nhận', 'Chi nhánh trung tâm', 'Người tạo', 'Bot Zalo', 'Trạng thái', 'Nháp']) {
      expect(svg).toContain(c);
    }
  });
  it('bảng đúng cột mẫu + khối tổng + 3 ô ký tên', () => {
    for (const c of ['STT', 'Mã SP', 'Tên sản phẩm', 'ĐVT', 'Đơn giá', 'Thành tiền',
      'Tổng số lượng', 'Tổng tiền hàng', 'Thuế', 'Tổng cộng',
      'NGƯỜI LẬP PHIẾU', 'THỦ KHO', 'NHÀ CUNG CẤP', 'Ký, ghi rõ họ tên']) {
      expect(svg).toContain(c);
    }
    expect(svg).toContain('13.030'); // tổng số lượng
    expect(svg).toContain('NB12V400W'); // cột mã
    expect(svg).not.toContain('[NB12V400W]'); // tên đã bóc tiền tố
  });
});

describe('maTuTen + nhanTrangThai', () => {
  it('mã lấy từ tiền tố [..], thiếu thì rỗng', () => {
    expect(maTuTen('[NB12V400W] Nguồn NB')).toBe('NB12V400W');
    expect(maTuTen('p10 full out LLR 260330')).toBe('');
  });
  it('trạng thái ra tiếng người', () => {
    expect(nhanTrangThai('draft')).toBe('Nháp');
    expect(nhanTrangThai('purchase')).toBe('Đã xác nhận');
  });
});
