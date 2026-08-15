// SPDX-License-Identifier: AGPL-3.0-or-later
// NHÓM B (15/08) — khối mục lục sản phẩm: có câu rào "tham khảo", rỗng thì im.
import { describe, it, expect } from 'vitest';
import { khoiMucLucChoPrompt } from '../../../src/modules/ai/knowledge/muc-luc.js';

describe('khoiMucLucChoPrompt', () => {
  it('null/rỗng → chuỗi rỗng, không chèn khung thừa vào prompt', () => {
    expect(khoiMucLucChoPrompt(null)).toBe('');
  });
  it('có mục lục → kèm câu rào THAM KHẢO + nhắc tra tool cho giá/tồn', () => {
    const ra = khoiMucLucChoPrompt('- Nguồn (24 SP): NB, ATX…');
    expect(ra).toContain('THAM KHẢO');
    expect(ra).toContain('tra tool');
    expect(ra).toContain('- Nguồn (24 SP)');
  });
});
