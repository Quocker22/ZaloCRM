// SPDX-License-Identifier: AGPL-3.0-or-later
// CẮT ĐOẠN THÔNG SỐ từ datasheet cho tin "đã gửi file kèm tóm tắt" (17:41 13/08).
//
// Đo prod: 900 ký tự đầu của "LLR -P10 -RGB OPLUNG" là header công ty + địa
// chỉ nhà máy + MỤC LỤC — tóm tắt từ đó ra toàn "Shenzhen... Baoan District".
// Thông số thật nằm ở mục "Product Technical Requirements" sâu phía sau, và
// mục lục cũng chứa đúng cụm chữ đó (kèm chuỗi chấm dài) — phải nhảy qua.
import { describe, it, expect } from 'vitest';
import { catDoanThongSo } from '../../../src/modules/ai/knowledge/kho-tai-lieu.js';

const HEADER = 'Shenzhen Leader Optoelectronic Technology Co., LTD Product Specifications '
  + 'Company address: 3rd and 4th floors, Building B, Fengzheng Industrial Park. '.repeat(30);
const MUC_LUC = 'Catalogue catalogue…………………… 2 1。 scope of application………… 3 '
  + '4Product Technical Requirements………………………… 6 7Installation Guide………… 8 ';
const THAN = '1. Scope of Application: This technical manual applies to rear cover series. '
  + 'Matters need attention: do not bend. '.repeat(30);
const SPEC = '4 Product Technical Requirements: Pixel pitch 10mm, resolution 32*16, '
  + 'brightness 5500cd/m2, refresh rate 1920Hz, power consumption 350W/m2, IP65.';

describe('catDoanThongSo — nhảy tới bảng thông số, bỏ qua header + mục lục', () => {
  it('hình dạng file thật (header→mục lục→thân→spec): trích phải chứa thông số', () => {
    const ra = catDoanThongSo(HEADER + MUC_LUC + THAN + SPEC + ' Acceptance requirements...');
    expect(ra).toContain('Pixel pitch 10mm');
    expect(ra).not.toContain('Fengzheng Industrial Park');
  });

  it('không có dấu hiệu thông số → vẫn trả một cửa sổ, không rỗng', () => {
    const noi = 'Tài liệu hướng dẫn lắp đặt chung chung. '.repeat(60);
    const ra = catDoanThongSo(noi);
    expect(ra.length).toBeLessThanOrEqual(1200);
    expect(ra.length).toBeGreaterThan(0);
  });

  it('chỉ có dòng kiểu mục lục → đành lấy từ đó, không trả rỗng', () => {
    const noi = HEADER + 'Product Technical Requirements………………………… 6 Page 2 of 11';
    expect(catDoanThongSo(noi)).toContain('Technical Requirements');
  });
});
