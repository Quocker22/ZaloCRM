// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { rankChunks } from '../../../src/modules/ai/knowledge/rank.js';

describe('rankChunks', () => {
  const chunks = [
    { id: 'near', content: 'gần', embedding: [1, 0, 0], embedDim: 3 },
    { id: 'far', content: 'xa', embedding: [0, 1, 0], embedDim: 3 },
  ];
  it('xếp theo cosine, lấy topK', () => {
    const hits = rankChunks([1, 0, 0], chunks, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].chunkId).toBe('near');
  });
  it('KB rỗng → []', () => {
    expect(rankChunks([1, 0, 0], [], 5)).toEqual([]);
  });
  it('bỏ chunk lệch chiều (cosine=0)', () => {
    const mixed = [{ id: 'wrongdim', content: 'x', embedding: [1, 0], embedDim: 2 }];
    expect(rankChunks([1, 0, 0], mixed, 5)).toEqual([]);
  });
});
