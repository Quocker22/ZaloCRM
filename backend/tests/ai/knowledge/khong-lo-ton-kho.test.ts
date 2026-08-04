// SPDX-License-Identifier: AGPL-3.0-or-later
// KHÔNG được lộ tồn kho cho khách — LUỒNG RAG CŨ.
//
// Anh chốt 2026-08-02: "khách hỏi sản phẩm này thì không nói tồn trong kho còn
// bao nhiêu, cứ báo là còn bình thường mặc dù không đủ, cứ tiếp tục nói chuyện
// lên đơn luôn cũng được, còn việc chuẩn bị hàng là của nhân viên".
//
// Quyết định đó ĐÃ áp vào luồng agent mới (bỏ hẳn tool `tra_ton_kho`) nhưng
// BỎ SÓT luồng RAG cũ — mà luồng cũ mới là cái đang phục vụ khách thật. Bug lộ
// ra 2026-08-04 khi bot trả lời khách: "em hỗ trợ báo giá và kiểm tra tồn kho
// cho mình nhé". 644 test lúc đó vẫn xanh vì không ai kiểm prompt luồng cũ.
import { describe, it, expect } from 'vitest';
import { industryPrompt } from '../../../src/modules/ai/knowledge/industry-prompts.js';
import { intentHint, classifyIntent } from '../../../src/modules/ai/knowledge/intent.js';

/**
 * Cụm khiến bot HỨA tra kho hoặc BÁO số tồn.
 *
 * Không kiểm chuỗi trần "kiểm tra tồn" — prompt có quyền chứa nó trong câu CẤM
 * ("KHÔNG nói để em kiểm tra tồn kho"). Chỉ bắt dạng KHẲNG ĐỊNH.
 */
const CAM = [
  'em hỗ trợ báo giá và kiểm tra tồn',
  'báo giá + tồn',
  'TỒN KHO đủ',
  'số tồn từ TÀI LIỆU',
  'dùng số tồn kho làm qty',
  'SỐ TỒN KHO trong tài liệu làm qty',
];

describe('Prompt ngành bán hàng KHÔNG hứa tra tồn', () => {
  const p = industryPrompt('ban_hang');
  const toanBo = [p.role, ...p.lines].join('\n');

  it.each(CAM)('không chứa: "%s"', (cum) => {
    expect(toanBo).not.toContain(cum);
  });

  it('role KHÔNG liệt kê tồn kho là việc bot làm', () => {
    // Đây chính là dòng sinh ra câu "em hỗ trợ báo giá và kiểm tra tồn kho".
    expect(p.role).not.toMatch(/tồn kho/i);
  });

  it('có chỉ thị RÕ cấm nói tồn', () => {
    expect(toanBo).toMatch(/KHÔNG NÓI VỀ TỒN KHO|KHÔNG báo số tồn/);
  });

  it('vẫn dạy bot nói CÒN HÀNG (không phải im lặng)', () => {
    // Cấm nói tồn ≠ né câu hỏi. Khách hỏi còn hàng vẫn phải được trả lời.
    expect(toanBo).toMatch(/cứ nói CÒN|CÒN HÀNG/i);
  });
});

describe('intentHint KHÔNG bắt bot báo số tồn', () => {
  it('hỏi tồn → nói CÒN, KHÔNG nói số', () => {
    const h = intentHint('stock');

    expect(h).toMatch(/CÒN HÀNG/);
    expect(h).toMatch(/KHÔNG nói số tồn/);
    // Bản cũ: "BẮT BUỘC: câu đầu PHẢI nói còn/hết + số tồn từ TÀI LIỆU nếu có."
    expect(h).not.toContain('số tồn từ TÀI LIỆU');
  });

  it('"lấy hết" → HỎI LẠI số lượng, không điền số tồn', () => {
    // Điền số tồn làm qty là lộ tồn kho gián tiếp: con số đó CHÍNH LÀ tồn.
    const h = intentHint('large_order');

    expect(h).toMatch(/HỎI LẠI/);
    expect(h).not.toContain('dùng số tồn kho làm qty');
  });

  it('đơn lớn VẪN chốt — cấm lộ tồn không phải cớ đẩy sale', () => {
    expect(intentHint('large_order')).toMatch(/VẪN CHỐT ĐƠN/);
  });
});

describe('Câu khách thật vẫn phân loại đúng', () => {
  it.each([
    ['còn hàng không shop', 'stock'],
    ['led 3 bóng còn không', 'stock'],
    ['có sẵn không anh', 'stock'],
  ])('"%s" → %s', (cau, mong) => {
    expect(classifyIntent(cau)).toBe(mong);
  });
});
