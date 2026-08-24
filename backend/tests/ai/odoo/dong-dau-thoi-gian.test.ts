// SPDX-License-Identifier: AGPL-3.0-or-later
// Yêu cầu anh Quyết 16:49 24/08: "Đơn hàng khi xuất ra thêm thời gian thực…
// nhiều đơn hơi giống nhau, anh em kho không để ý là xót đơn. Để 24H nhé."
// → đóng dấu giờ phút 24H (giờ VN) lên chính ẢNH hoá đơn bot gửi.
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { chuoiThoiGianVn, dongDauThoiGian } from '../../../src/modules/ai/odoo/hoa-don-anh.js';

describe('chuoiThoiGianVn — định dạng 24H giờ Việt Nam', () => {
  it('chiều 16:49 UTC+7 ra "16:49 24/08/2026", KHÔNG phải 4:49 PM', () => {
    // 16:49 24/08/2026 giờ VN = 09:49 UTC.
    expect(chuoiThoiGianVn(new Date('2026-08-24T09:49:00Z'))).toBe('16:49 24/08/2026');
  });
  it('nửa đêm giữ 2 chữ số: 00:05', () => {
    // 00:05 25/08 VN = 17:05 24/08 UTC.
    expect(chuoiThoiGianVn(new Date('2026-08-24T17:05:00Z'))).toBe('00:05 25/08/2026');
  });
});

describe('dongDauThoiGian — đóng dấu lên ảnh PNG', () => {
  it('ảnh ra vẫn là PNG cùng kích thước, nội dung ĐÃ đổi (có dấu)', async () => {
    const goc = await sharp({
      create: { width: 400, height: 200, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).png().toBuffer();

    const ra = await dongDauThoiGian(goc, new Date('2026-08-24T09:49:00Z'));

    expect(ra.subarray(1, 4).toString()).toBe('PNG');
    const meta = await sharp(ra).metadata();
    expect(meta.width).toBe(400);
    expect(meta.height).toBe(200);
    expect(ra.equals(goc)).toBe(false);
  });

  it('ảnh hỏng → trả NGUYÊN ảnh gốc, không ném (dấu giờ là phụ, ảnh hoá đơn là chính)', async () => {
    const hong = Buffer.from('khong phai anh');
    expect((await dongDauThoiGian(hong)).equals(hong)).toBe(true);
  });
});
