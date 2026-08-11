// SPDX-License-Identifier: AGPL-3.0-or-later
// Khoá hành vi của mẫu tra KHÔNG PHỤ THUỘC DẤU (xem src/modules/ai/odoo/tim-khong-dau.ts).
//
// Vì sao cần: `ilike` của Postgres prod KHÔNG bỏ dấu (extension unaccent không
// bật). Đo thật 11/08 — nhân viên gõ không dấu là trượt sạch ở CẢ BA tập:
//   khách ['name','ilike','Thuc'] -> 0 kq (có dấu 'Thức' -> 3 kq)
//   SP    ['name','ilike','Nguon']-> 0 kq (có dấu 'Nguồn' -> 5 kq)
//   NCC   ['name','ilike','trung quoc'] -> 0 kq (có dấu -> 2 kq)
import { describe, it, expect } from 'vitest';
import { mauKhongDau, dieuKienKhongDau } from '../../../src/modules/ai/odoo/tim-khong-dau.js';

/** `ilike` của Postgres: `_` = 1 ký tự bất kỳ, `%` = chuỗi bất kỳ, bỏ qua hoa/thường. */
function ilike(mau: string, giaTri: string): boolean {
  let re = '';
  for (let i = 0; i < mau.length; i++) {
    const c = mau[i];
    if (c === '\\' && i + 1 < mau.length) { re += mau[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (c === '_') { re += '.'; continue; }
    if (c === '%') { re += '.*'; continue; }
    re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re, 'i').test(giaTri);
}
const khop = (tuKhoa: string, ten: string) => ilike(`%${mauKhongDau(tuKhoa)}%`, ten);

describe('mauKhongDau — gõ kiểu nào cũng khớp', () => {
  it('gõ CÓ DẤU và KHÔNG DẤU cho ra CÙNG một mẫu', () => {
    // Đây là tính chất cốt lõi: hai kiểu gõ phải quy về một truy vấn.
    expect(mauKhongDau('Trung Quốc')).toBe(mauKhongDau('trung quoc'));
    expect(mauKhongDau('Nguồn')).toBe(mauKhongDau('nguon'));
  });

  it('khớp được tên CÓ DẤU thật trên prod dù gõ không dấu', () => {
    // Đúng ba ca đã đo trượt trên prod 11/08.
    expect(khop('trung quoc', 'Trung Quốc')).toBe(true);
    expect(khop('trung quoc', 'Trung Quốc- Kho Cô Lỳ')).toBe(true);
    expect(khop('thuc', 'Anh Thức CNC')).toBe(true);
    expect(khop('nguon', 'Nguồn ATX Trong Nhà 12V400W Pro (cái)')).toBe(true);
    expect(khop('day dien', 'Dây điện 0.2 (m)')).toBe(true);
    expect(khop('long led', 'Anh Long Led')).toBe(true);
  });

  it('gõ ĐÚNG DẤU vẫn khớp như cũ — không phá đường đang chạy được', () => {
    expect(khop('Trung Quốc', 'Trung Quốc')).toBe(true);
    expect(khop('Nguồn', 'Nguồn 12v29A')).toBe(true);
  });

  it('KHÔNG khớp bừa tên khác hẳn', () => {
    // `_` nới rộng nhưng vẫn phải giữ đúng ĐỘ DÀI và các phụ âm — không được
    // biến thành "khớp mọi thứ". Tầng xepHangKhach phía sau lọc tiếp phần rộng.
    expect(khop('trung quoc', 'Mogen Star')).toBe(false);
    expect(khop('nguon', 'Màn hình LED P10')).toBe(false);
  });

  it('THOÁT ký tự wildcard nhân viên gõ — "50%" không thành "khớp mọi thứ"', () => {
    // Không thoát thì '%' của người dùng thành wildcard SQL và lôi về cả bảng.
    expect(mauKhongDau('50%')).toBe('50\\%');
    expect(khop('50%', 'Chiết khấu 50% cuối năm')).toBe(true);
    expect(khop('50%', 'Chiết khấu 70% cuối năm')).toBe(false);
  });

  it('dieuKienKhongDau trả đúng bộ ba domain Odoo', () => {
    // 'u' trong "quoc" cũng là nguyên âm nên cũng thành '_' → "q__c". Đo prod
    // 11/08 thì "tr_ng q__c" và "tr_ng qu_c" cho CÙNG 2 NCC, nên không cần thêm
    // luật riêng cho cặp 'qu' — giữ luật đơn giản: mọi nguyên âm đều thay.
    expect(dieuKienKhongDau('name', 'trung quoc')).toEqual(['name', 'ilike', 'tr_ng q__c']);
  });

  it('MẪU PHẢI HẸP — chỉ thay nguyên âm, giữ nguyên phụ âm', () => {
    // Ca thật bắt lỗi (replay-long-led-11-08): thay cả phụ âm thì "led" hoá
    // "l__" và khớp luôn "Long", "Hạ Long", "Long Biên" — tra "Anh Long Led"
    // ra 11 người thay vì đúng 1. Phụ âm không mang dấu, không được nới.
    expect(mauKhongDau('led')).toBe('l_d');
    expect(mauKhongDau('long')).toBe('l_ng');
    // "long led" phải chỉ còn khớp đúng người có CẢ hai từ, không ôm "Hạ Long".
    expect(khop('led', 'Anh Long Led')).toBe(true);
    expect(khop('led', 'Anh Hùng - QC Đa Hình Hạ Long')).toBe(false);
    expect(khop('led', 'Anh Long Biên')).toBe(false);
  });

  it("'d' đầu từ VẪN thay được (vì 'đ'), giữa/cuối từ thì không", () => {
    // "dien" phải khớp "điện" — 'đ' chỉ nằm ở đầu từ tiếng Việt.
    expect(khop('dien', 'Dây điện 0.2 (m)')).toBe(true);
    expect(khop('do', 'Led đỏ 5050')).toBe(true);
    // Nhưng 'd' cuối từ ("led") giữ nguyên là chữ 'd' thật.
    expect(mauKhongDau('led')).toBe('l_d');
  });
});
