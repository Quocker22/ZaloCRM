// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { cosine } from '../../../src/modules/ai/knowledge/cosine.js';

describe('cosine', () => {
  it('identical vectors → ~1', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it('orthogonal → ~0', () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
  it('length mismatch → 0', () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
  });
  it('zero vector → 0', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});
