// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: phát hiện bực/chửi (07/08, học Chatwoot).
//
// Bug gốc 06/08: "mẹ mày. Cả đi" → bot lấy "Cả" tra thành tên SP. Giờ: tin
// bực/chửi → báo nhân viên, bot ngừng (người xoa dịu tốt hơn bot máy móc).
import { describe, it, expect } from 'vitest';
import { laBucTuc } from '../../../src/modules/ai/agent/noi-zalo/cam-xuc.js';

describe('laBucTuc — bắt chửi/bực RÕ RÀNG', () => {
  it('CÂU GỐC gây bug phải bị bắt', () => {
    expect(laBucTuc('mẹ mày. Cả đi')).toBe(true);
  });

  it.each([
    'dm cái shop này', 'ngu vl', 'làm ăn kiểu gì thế', 'vô dụng',
    'thất vọng quá', 'me may lam an the a', 'đồ ngu', 'chán quá đi',
  ])('bắt: "%s"', (c) => expect(laBucTuc(c)).toBe(true));

  it('bắt cả khi gõ KHÔNG DẤU', () => {
    expect(laBucTuc('me may')).toBe(true);
    expect(laBucTuc('do ngu')).toBe(true);
  });

  it.each([
    'cho em hỏi giá đèn led',
    'lên đơn 10 cái nguồn NB',
    'sao lâu thế ạ',            // hơi gắt nhưng KHÔNG chửi — không bắt
    'success rồi nhé',           // "cc" nằm giữa success — ranh giới từ
    'level 5 màu trắng',         // "vl" giữa level — ranh giới từ
    'còn hàng không shop',
    '',
  ])('KHÔNG bắt nhầm câu bình thường: "%s"', (c) => expect(laBucTuc(c)).toBe(false));
});
