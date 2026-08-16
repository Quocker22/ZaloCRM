// SPDX-License-Identifier: AGPL-3.0-or-later
// CA 16/08 — ảnh phiếu nhập TỰ VẼ + link phiếu dạng /web# (anh Quốc: "ủa
// phiếu này đâu phải phiếu custom của tôi", "link .../vi/odoo/purchase/14592
// cũng sai nhé"). Prod không có report custom cho purchase → tự vẽ bằng
// anh-bang; link mirror đơn bán với action 482 "Danh sách phiếu nhập".
import { describe, it, expect } from 'vitest';
import { bangPhieuNhap } from '../../../src/modules/ai/odoo/anh-phieu-nhap.js';
import { linkXuLyDonMua } from '../../../src/modules/ai/odoo/hoa-don-anh.js';

describe('bangPhieuNhap — khuôn phiếu tự vẽ', () => {
  it('đủ tiêu đề NCC, cột, dòng, tổng; dòng chưa giá ghi "chưa có" không ghi 0đ', () => {
    const bang = bangPhieuNhap(
      { ma: 'P04527', ncc: 'Trung Quốc', ngay: '2026-08-16' },
      [
        { ten: 'Nguồn NB 12V400W', sl: 3030, gia: 0, thanhTien: 0 },
        { ten: 'p10 full out LLR 260330', sl: 10000, gia: 164640, thanhTien: 1646400000 },
      ],
    );
    expect(bang.tieuDe).toBe('PHIẾU NHẬP HÀNG P04527 — NCC Trung Quốc');
    expect(bang.cot).toEqual(['Tên hàng', 'SL', 'Giá nhập', 'Thành tiền']);
    expect(bang.dong[0]).toEqual(['Nguồn NB 12V400W', '3.030', 'chưa có', '—']);
    expect(bang.dong[1][3]).toBe('1.646.400.000đ');
    expect(bang.tongCong?.[3]).toBe('1.646.400.000đ');
  });
});

describe('linkXuLyDonMua — dạng /web# như đơn bán, hết /odoo/purchase hỏng', () => {
  it('mặc định action 482, không còn đường /odoo/purchase', () => {
    const link = linkXuLyDonMua('https://led.incokit.com/', 14592);
    expect(link).toContain('/web#id=14592');
    expect(link).toContain('action=482');
    expect(link).toContain('model=purchase.order');
    expect(link).not.toContain('/odoo/purchase');
  });
});
