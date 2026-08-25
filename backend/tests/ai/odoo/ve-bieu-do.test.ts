// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { rutGonTien, bieuDoCot, bieuDoCotNgang } from '../../../src/modules/ai/odoo/ve-bieu-do.js';

describe('rutGonTien — nhãn tiền trên cột', () => {
  it('triệu/nghìn/tỷ rút gọn kiểu Việt', () => {
    expect(rutGonTien(12_500_000)).toBe('12,5tr');
    expect(rutGonTien(78_000)).toBe('78k');
    expect(rutGonTien(1_250_000_000)).toBe('1,25 tỷ');
    expect(rutGonTien(3_000_000)).toBe('3tr');
    expect(rutGonTien(0)).toBe('0');
  });
});

describe('bieuDoCot / bieuDoCotNgang → PNG', () => {
  it('cột dọc 6 tháng ra PNG hợp lệ, có tháng 0 vẫn vẽ', async () => {
    const png = await bieuDoCot({
      tieuDe: 'Doanh số Anh Long Led',
      phuDe: 'Hoá đơn đã vào sổ · 03/2026 – 08/2026',
      nhan: ['03/26', '04/26', '05/26', '06/26', '07/26', '08/26'],
      giaTri: [12_500_000, 0, 8_200_000, 23_460_000, 3_950_000, 0],
      ghiChu: 'Tổng 48,1tr · TB 8tr/tháng',
    });
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const m = await sharp(png).metadata();
    expect(m.width).toBeGreaterThanOrEqual(520);
    expect(m.height).toBeGreaterThan(300);
  });

  it('cột ngang top khách: tên có ký tự XML (&, <) không làm hỏng SVG', async () => {
    const png = await bieuDoCotNgang({
      tieuDe: 'Top khách tháng này',
      nhan: ['Anh Long Led & Co', 'Cty <ABC>', 'Chị Hoa'],
      giaTri: [23_460_000, 9_000_000, 1_500_000],
    });
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });

  it('toàn 0 → vẫn ra ảnh (không chia cho 0)', async () => {
    const png = await bieuDoCot({ tieuDe: 'Trống', nhan: ['07/26', '08/26'], giaTri: [0, 0] });
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });
});
