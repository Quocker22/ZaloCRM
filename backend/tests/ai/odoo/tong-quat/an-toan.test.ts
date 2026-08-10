// SPDX-License-Identifier: AGPL-3.0-or-later
// Hàng rào của tool Odoo tổng quát. Hai phanh phải nằm ở CODE, không phải
// prompt — bot đã bịa id khách, lặp vô tận, kẹt phiên chỉ trong một tuần.
import { describe, it, expect } from 'vitest';
import { laCotCam, locCotCam, quyetDinhPhanh, NGUONG_HANG_LOAT }
  from '../../../../src/modules/ai/odoo/tong-quat/an-toan.js';

describe('cột cấm', () => {
  it('chặn giá vốn và mọi biến thể chứa cost/margin', () => {
    expect(laCotCam('standard_price')).toBe(true);
    expect(laCotCam('margin')).toBe(true);
    expect(laCotCam('purchase_price')).toBe(true);
    expect(laCotCam('x_cost_extra')).toBe(true);
    expect(laCotCam('list_price')).toBe(false);
    expect(laCotCam('name')).toBe(false);
  });
  it('locCotCam tách sạch/cấm, giữ thứ tự', () => {
    expect(locCotCam(['name', 'standard_price', 'list_price']))
      .toEqual({ sach: ['name', 'list_price'], cam: ['standard_price'] });
  });
});

describe('phanh', () => {
  it('XOÁ luôn phải xác nhận, dù chỉ 1 bản ghi', () => {
    expect(quyetDinhPhanh({ viec: 'goi_nut', nut: 'unlink', soBanGhi: 1 }))
      .toEqual({ chay: false, lyDo: 'xoa', soBanGhi: 1 });
  });
  it('xoá + đã xác nhận → chạy', () => {
    expect(quyetDinhPhanh({ viec: 'goi_nut', nut: 'unlink', soBanGhi: 1, xacNhan: true }))
      .toEqual({ chay: true });
  });
  it('đúng ngưỡng thì chạy, vượt một bản ghi thì phải xác nhận', () => {
    expect(quyetDinhPhanh({ viec: 'sua', soBanGhi: NGUONG_HANG_LOAT }).chay).toBe(true);
    expect(quyetDinhPhanh({ viec: 'sua', soBanGhi: NGUONG_HANG_LOAT + 1 }))
      .toEqual({ chay: false, lyDo: 'hang_loat', soBanGhi: NGUONG_HANG_LOAT + 1 });
  });
  it('ghi thường 1 bản ghi → chạy luôn, không hỏi (anh Quốc chốt 10/08)', () => {
    expect(quyetDinhPhanh({ viec: 'goi_nut', nut: 'action_confirm', soBanGhi: 1 }))
      .toEqual({ chay: true });
  });
});
