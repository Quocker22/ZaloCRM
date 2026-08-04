// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { findImageForReply } from '../../../src/modules/ai/knowledge/product-image.js';

// Test dựa trên kho ảnh thật (product-images/_kb_match.json). Nếu chưa crawl ảnh thì
// findImageForReply trả null cho mọi input — các test "khớp" sẽ skip mềm (không fail build).
describe('findImageForReply (gửi ảnh SP chủ động)', () => {
  it('câu mơ hồ / nhiều loại → KHÔNG gửi ảnh (null)', () => {
    expect(findImageForReply('Dạ bên em có nhiều loại led dây, anh cần màu gì ạ')).toBeNull();
    expect(findImageForReply('Dạ anh cần tư vấn sản phẩm nào ạ')).toBeNull();
  });
  it('reply rỗng → null', () => {
    expect(findImageForReply('')).toBeNull();
  });
  it('nhắc đúng 1 SP có model-code → trả ảnh (nếu kho ảnh đã có)', () => {
    const r = findImageForReply('Dạ bên em có Led 3 bóng ATX 6214 màu trắng giá 35.000đ ạ');
    // kho ảnh có → path .jpg/.png/.webp; chưa crawl → null (không fail).
    if (r !== null) expect(r).toMatch(/\.(jpg|jpeg|png|webp)$/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('KHÔNG gửi ảnh khi câu trả lời là LIỆT KÊ DANH MỤC', () => {
  // Bug thật 2026-08-05: khách hỏi "nhà có led gì nhỉ", bot liệt kê 7 nhóm hàng
  // rồi gửi kèm ảnh "Module 3 LED 220V" — chẳng liên quan. Câu liệt kê chứa
  // nhiều từ chung ("led","dây","bóng") nên trùng ≥60% với tên một SP ngắn.
  it('câu có ≥3 gạch đầu dòng → KHÔNG gửi ảnh', () => {
    const liet = [
      'Dạ shop em bán nhiều dòng LED:',
      '- LED dải dây, LED ziczac',
      '- LED trang trí neon 8x16',
      '- LED đúc, LED tròn, bóng cắm F30',
      '- Card điều khiển, nguồn LED',
    ].join('\n');

    expect(findImageForReply(liet)).toBeNull();
  });

  it('danh sách đánh SỐ cũng bị chặn', () => {
    const liet = [
      'Dạ dây ziczac bên em có nhiều loại:',
      '1. Led ziczac full cuộn 5m 60led/m',
      '2. Led dây ziczac 42b/m trắng 12000k',
      '3. Led ziczac 120led/m Lixin đỏ',
    ].join('\n');

    expect(findImageForReply(liet)).toBeNull();
  });

  it('câu nhắc ĐÚNG MỘT sản phẩm thì VẪN gửi', () => {
    // Chặn liệt kê không được làm mất tính năng gửi ảnh khi khách hỏi cụ thể.
    const mot = 'Dạ sản phẩm Led dây ZicZac 60b/m Lixin màu trắng 11000k (291024) giá 330.000đ ạ.';

    expect(findImageForReply(mot)).not.toBeNull();
  });
});
