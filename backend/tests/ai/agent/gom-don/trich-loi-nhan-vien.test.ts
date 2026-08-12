// SPDX-License-Identifier: AGPL-3.0-or-later
// CA THẬT 11:52:46 ngày 12/08/2026 — bot nhắn ra một câu vô nghĩa:
//
//   Em vẫn chưa khớp được "@Tiểu Mã Nelia đây lấy từ trong ảnh ra
//   [Khách gửi ảnh, nội dung trong ảnh: P10 f" với nhà cung cấp nào ạ.
//
// Anh Quốc nhìn chỗ đứt giữa chữ "full" tưởng model đọc ảnh hụt, định đổi sang
// minimax-m3. ĐO RỒI: chuỗi đó dài ĐÚNG 80 ký tự — dấu vết của `slice(0, 80)`
// trong câu template, không phải model đọc thiếu. Model đọc đủ cả 20 dòng hàng.
import { describe, it, expect } from 'vitest';
import { trichLoiNhanVien } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';

// Chuỗi THÔ đúng như prod dựng: lời nhắn + xuống dòng + khối ảnh của luong-media.
const CAU_THAT =
  '@Tiểu Mã Nelia đây lấy từ trong ảnh ra\n' +
  '[Khách gửi ảnh, nội dung trong ảnh: P10 full out: 10.000 tấm | 242 thùng. ' +
  'P5 full out: 1460 tấm. Cabin 960*960*120: 80 cái. Quạt gió: 160 cái. ' +
  'RY3-800W: 109. 12V600W: 1263. DM 12V400W: 1616. NB-12V400W: 3030.]';

describe('trichLoiNhanVien — ca thật 11:52:46 12/08', () => {
  it('KHÔNG để khối "[Khách gửi ảnh…]" lọt ra tin gửi người', () => {
    const ra = trichLoiNhanVien(CAU_THAT);
    expect(ra).not.toContain('[Khách gửi ảnh');
    expect(ra).not.toContain('nội dung trong ảnh');
  });

  it('KHÔNG cắt giữa chừng một chữ (ca "P10 f" cụt giữa chữ full)', () => {
    const ra = trichLoiNhanVien(CAU_THAT);
    expect(ra).not.toContain('P10 f');
    // Giữ được lời nhân viên thật sự gõ.
    expect(ra).toContain('đây lấy từ trong ảnh ra');
  });

  it('bóc tag gọi bot — tag không phải nội dung, để lại chỉ chiếm chỗ', () => {
    expect(trichLoiNhanVien(CAU_THAT)).not.toContain('@Tiểu Mã Nelia');
  });

  // Bẫy đã dính khi viết hàm này: regex nuốt mọi từ viết hoa sau `@` thì ăn lẹm
  // sang lời nhân viên. Hai ca dưới khoá lại — ca thứ hai chính là bug 16:15
  // 11/08 (tên khách "Anh Long Led" bị bóc mất).
  it('bóc tag nhưng KHÔNG ăn lẹm chữ hoa mở đầu lời nhân viên', () => {
    expect(trichLoiNhanVien('@Tiểu Mã Nelia đây lấy từ trong ảnh ra'))
      .toBe('đây lấy từ trong ảnh ra');
  });

  it('bóc tag KHÔNG được nuốt tên khách viết hoa (bug 16:15 11/08)', () => {
    expect(trichLoiNhanVien('@bot Anh Long Led')).toContain('Anh Long Led');
  });

  it('ảnh KHÔNG kèm lời nhắn → trả rỗng để caller bỏ luôn phần trích', () => {
    expect(trichLoiNhanVien('[Khách gửi ảnh, nội dung trong ảnh: P10 full out]')).toBe('');
  });

  it('câu ngắn bình thường thì giữ NGUYÊN VẸN, không đụng vào', () => {
    expect(trichLoiNhanVien('led thanh 1m 5054 trắng')).toBe('led thanh 1m 5054 trắng');
  });

  it('câu dài quá trần thì cắt ở ranh giới TỪ và báo bằng dấu …', () => {
    const dai = 'nguồn ngoài trời 12V 100W loại tốt hàng chính hãng bảo hành 12 tháng '
      + 'giao trong ngày cho khách quen';
    const ra = trichLoiNhanVien(dai);
    expect(ra.endsWith('…')).toBe(true);
    // Bỏ dấu … thì phần còn lại phải là tiền tố ĐÚNG TỪ của câu gốc.
    expect(dai.startsWith(ra.slice(0, -1))).toBe(true);
    expect(ra.length).toBeLessThanOrEqual(81);
  });

  it('một từ dài ngoằng không có khoảng trắng vẫn cắt được, không ném lỗi', () => {
    const ra = trichLoiNhanVien('y'.repeat(200));
    expect(ra.endsWith('…')).toBe(true);
    expect(ra.length).toBeLessThanOrEqual(81);
  });
});
