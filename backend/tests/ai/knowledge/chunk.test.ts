// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { chunkText } from '../../../src/modules/ai/knowledge/chunk.js';

describe('chunkText', () => {
  it('cắt theo dòng trống thành nhiều chunk', () => {
    const out = chunkText('Đoạn một.\n\nĐoạn hai dài hơn.\n\nĐoạn ba.', 20);
    expect(out.length).toBeGreaterThan(1);
    expect(out.every((c) => c.trim().length > 0)).toBe(true);
  });
  it('text rỗng → mảng rỗng', () => {
    expect(chunkText('   ', 500)).toEqual([]);
  });
  it('một đoạn ngắn → một chunk', () => {
    expect(chunkText('Xin chào.', 500)).toEqual(['Xin chào.']);
  });
});
