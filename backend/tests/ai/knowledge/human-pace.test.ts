// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { humanDelayMs } from '../../../src/modules/ai/knowledge/human-pace.js';

describe('humanDelayMs (nhịp gõ người, chống Zalo flag)', () => {
  it('luôn nằm trong [1500, 9000] ms', () => {
    for (const len of [0, 20, 100, 300, 1000]) {
      for (let i = 0; i < 10; i++) {
        const ms = humanDelayMs(len);
        expect(ms).toBeGreaterThanOrEqual(1500);
        expect(ms).toBeLessThanOrEqual(9000);
      }
    }
  });
  it('tin dài trung bình lâu hơn tin ngắn (mô phỏng thời gian gõ)', () => {
    const avg = (len: number) => {
      let s = 0;
      for (let i = 0; i < 30; i++) s += humanDelayMs(len);
      return s / 30;
    };
    expect(avg(300)).toBeGreaterThan(avg(20));
  });
  it('có jitter ngẫu nhiên (không phải hằng số cứng)', () => {
    const vals = new Set(Array.from({ length: 20 }, () => humanDelayMs(200)));
    expect(vals.size).toBeGreaterThan(1);
  });
});
