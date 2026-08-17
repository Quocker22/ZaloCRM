// SPDX-License-Identifier: AGPL-3.0-or-later
// 17/08 22:27 — bot nhả độc thoại nội tâm ra Zalo (lần 2 sau ca catalog 13/08).
// Cổng ra bocDocThoai: cắt khối "nghĩ thành lời" trước câu trả lời thật; không
// chắc thì GIỮ NGUYÊN.
import { describe, it, expect } from 'vitest';
import { bocDocThoai } from '../../../../src/modules/ai/agent/noi-zalo/bo-markdown.js';

const CA_THAT = `Câu hỏi của nhân viên: "cho tôi QR của ngân hàng đi" — vẫn là hỏi thông tin ngân hàng của shop, lần trước đã trả lời là em không có. Đây không phải là dừng/sửa/lên đơn. Lặp lại câu hỏi ngân hàng.

Em đã trả lời trước đó là không có thông tin ngân hàng. Tôi chỉ cần nhắc lại ngắn gọn.

Không có tool ghi. Không có tool tra ngân hàng. Đáp lại.

Anh/chị ơi, bên em không có thông tin số tài khoản hay mã QR ngân hàng của shop trong hệ thống đâu ạ. Anh/chị nhờ kế toán hoặc quản lý cung cấp giúp em mã QR để gửi cho khách nhé.`;

describe('bocDocThoai', () => {
  it('ca thật 22:27: cắt sạch 3 đoạn suy nghĩ, giữ nguyên câu trả lời', () => {
    const ra = bocDocThoai(CA_THAT);
    expect(ra.startsWith('Anh/chị ơi, bên em')).toBe(true);
    expect(ra).not.toMatch(/Tôi chỉ cần|Không có tool|Đáp lại|Câu hỏi của nhân viên/);
  });
  it('tin bình thường nhiều đoạn (không có dấu hiệu nghĩ) → GIỮ NGUYÊN', () => {
    const t = 'Đơn cho Anh Tiến (KH000028):\n10 × Nguồn DF = 1.800.000đ\n\nEm đã lên đơn nháp S14710 ạ.';
    expect(bocDocThoai(t)).toBe(t);
  });
  it('một đoạn duy nhất → giữ nguyên dù có chữ "tôi" (không đủ bằng chứng)', () => {
    const t = 'Tôi đã kiểm tra rồi ạ, tồn kho còn 30 cái.';
    expect(bocDocThoai(t)).toBe(t);
  });
  it('khối trước có dấu hiệu nghĩ nhưng KHÔNG có đoạn trả lời thật phía sau → giữ nguyên (không cắt bừa)', () => {
    const t = 'Tôi cần tra tồn kho.\n\nTồn: 30 cái ạ.';
    // đoạn 2 mở đầu "Tồn" khớp MO_DAU → cắt được; kiểm ngược: đoạn 2 KHÔNG khớp thì phải giữ
    const t2 = 'Tôi cần tra tồn kho.\n\n30 cái ạ.';
    expect(bocDocThoai(t2)).toBe(t2);
    expect(bocDocThoai(t)).toBe('Tồn: 30 cái ạ.');
  });
});
