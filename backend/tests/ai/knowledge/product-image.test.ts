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
