// SPDX-License-Identifier: AGPL-3.0-or-later
// Cấu hình máy in từ env — chưa đặt AI_MAY_IN_IPP_URL thì toàn hệ coi như
// KHÔNG có máy in: tool không đăng ký, cron không chạy. Một biến bật/tắt.
import { describe, it, expect } from 'vitest';
import { ippConfigTuEnv, agentConfigTuEnv, coMayIn } from '../../../src/modules/ai/may-in/tu-env.js';

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

describe('agentConfigTuEnv', () => {
  it('thiếu AI_MAY_IN_AGENT_TOKEN → null', () => {
    expect(agentConfigTuEnv({})).toBeNull();
    expect(agentConfigTuEnv({ AI_MAY_IN_ORG_ID: 'org1' })).toBeNull();
  });

  it('có token nhưng thiếu AI_MAY_IN_ORG_ID → null (cron không được tự bịa org)', () => {
    expect(agentConfigTuEnv({ AI_MAY_IN_AGENT_TOKEN: 'tok' })).toBeNull();
  });

  it('có đủ token + orgId → config với paperSize/tray mặc định A5/tray-2', () => {
    expect(agentConfigTuEnv({ AI_MAY_IN_AGENT_TOKEN: 'tok', AI_MAY_IN_ORG_ID: 'org1' })).toEqual({
      orgId: 'org1',
      paperSize: 'A5',
      tray: 'tray-2',
    });
  });

  it('chỉnh được paperSize/tray qua env', () => {
    expect(
      agentConfigTuEnv({
        AI_MAY_IN_AGENT_TOKEN: 'tok',
        AI_MAY_IN_ORG_ID: 'org1',
        AI_MAY_IN_PAPER_SIZE: 'A4',
        AI_MAY_IN_TRAY: 'tray-1',
      }),
    ).toEqual({ orgId: 'org1', paperSize: 'A4', tray: 'tray-1' });
  });
});

describe('coMayIn', () => {
  // Fix round review Task 5: luong-nhan-vien.ts trước đây chỉ gate tool
  // in_hoa_don bằng ippConfigTuEnv() — triển khai thuần-agent (có
  // AI_MAY_IN_AGENT_TOKEN+AI_MAY_IN_ORG_ID, KHÔNG có AI_MAY_IN_IPP_URL) thì
  // cron in được (chonClientMayIn ưu tiên AgentClient) nhưng tool KHÔNG đăng
  // ký — nhân viên không gọi được lệnh in dù hệ có máy in qua kênh agent.
  it('không có gì → false', () => {
    expect(coMayIn({})).toBe(false);
  });

  it('chỉ có IPP → true', () => {
    expect(coMayIn({ AI_MAY_IN_IPP_URL: 'ipp://192.168.1.50:631/ipp/print' })).toBe(true);
  });

  it('chỉ có agent (token + orgId, KHÔNG có IPP) → true', () => {
    expect(coMayIn({ AI_MAY_IN_AGENT_TOKEN: 'tok', AI_MAY_IN_ORG_ID: 'org1' })).toBe(true);
  });

  it('có agent token nhưng THIẾU orgId (agentConfigTuEnv trả null), không IPP → false', () => {
    expect(coMayIn({ AI_MAY_IN_AGENT_TOKEN: 'tok' })).toBe(false);
  });

  it('có cả hai kênh → true', () => {
    expect(
      coMayIn({
        AI_MAY_IN_IPP_URL: 'ipp://192.168.1.50:631/ipp/print',
        AI_MAY_IN_AGENT_TOKEN: 'tok',
        AI_MAY_IN_ORG_ID: 'org1',
      }),
    ).toBe(true);
  });
});
