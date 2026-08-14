// SPDX-License-Identifier: AGPL-3.0-or-later
// A1 (14/08) — BẢO HIỂM chống memory tự nhiễm, học TencentDB capture.ts:
// khối do hệ thống tự ghép ([Khách gửi ảnh…], [Trả lời tin: "…"]) không được
// phép quay lại lịch sử đưa cho model. Đường lưu hôm nay đã đúng (lưu thô ngay
// webhook) — test này khoá LỚP HAI cho ngày nào đó có đường lưu mới quên luật.
import { describe, it, expect } from 'vitest';
import { bocKhoiTuBom } from '../../../../src/modules/ai/agent/noi-zalo/du-lieu.js';

describe('bocKhoiTuBom — bóc khối tự bơm khỏi lịch sử', () => {
  it('nội dung sạch đi qua NGUYÊN VẸN', () => {
    expect(bocKhoiTuBom('lên đơn cho anh Hà 10 cái nguồn NB')).toBe('lên đơn cho anh Hà 10 cái nguồn NB');
    expect(bocKhoiTuBom('giá [khuyến mãi] 1800đ nhé')).toBe('giá [khuyến mãi] 1800đ nhé');
  });

  it('khối quote-reply đầu câu bị bóc, giữ câu thật', () => {
    expect(bocKhoiTuBom('[Trả lời tin: "danh sách 15 khách..."] chọn số 5')).toBe('chọn số 5');
  });

  it('khối ảnh đa dòng bị bóc sạch — kể cả phần mô tả bên trong', () => {
    const nd = 'lên đơn nhé [Khách gửi ảnh danh sách hàng:\n- Led P10: 100\n- Nguồn NB: 50\n]';
    const ra = bocKhoiTuBom(nd);
    expect(ra).toBe('lên đơn nhé');
    expect(ra).not.toContain('Led P10');
  });
});
