// SPDX-License-Identifier: AGPL-3.0-or-later
// Cấu hình máy in từ env — chưa đặt AI_MAY_IN_IPP_URL thì toàn hệ coi như
// KHÔNG có máy in: tool không đăng ký, cron không chạy. Một biến bật/tắt.
import { describe, it, expect } from 'vitest';
import { ippConfigTuEnv } from '../../../src/modules/ai/may-in/tu-env.js';

describe('ippConfigTuEnv', () => {
  it('chưa đặt AI_MAY_IN_IPP_URL → null (hệ không có máy in)', () => {
    expect(ippConfigTuEnv({})).toBeNull();
    expect(ippConfigTuEnv({ AI_MAY_IN_IPP_URL: '  ' })).toBeNull();
  });

  it('đặt URL → config với uri đúng, timeout mặc định', () => {
    const cfg = ippConfigTuEnv({ AI_MAY_IN_IPP_URL: 'ipp://192.168.1.50:631/ipp/print' });
    expect(cfg).toEqual({ uri: 'ipp://192.168.1.50:631/ipp/print', timeoutMs: 15_000, nguoiGui: 'zalocrm' });
  });

  it('chỉnh được timeout qua AI_MAY_IN_TIMEOUT_MS; giá trị rác → mặc định', () => {
    expect(
      ippConfigTuEnv({ AI_MAY_IN_IPP_URL: 'ipp://x/ipp/print', AI_MAY_IN_TIMEOUT_MS: '5000' })?.timeoutMs,
    ).toBe(5000);
    expect(
      ippConfigTuEnv({ AI_MAY_IN_IPP_URL: 'ipp://x/ipp/print', AI_MAY_IN_TIMEOUT_MS: 'abc' })?.timeoutMs,
    ).toBe(15_000);
  });
});
