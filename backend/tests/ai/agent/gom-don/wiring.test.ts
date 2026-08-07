// SPDX-License-Identifier: AGPL-3.0-or-later
// Wiring: máy gom đơn đứng TRƯỚC agent thường trong xuLyTinNhanVien.
// Máy nhận (true) → agent thường KHÔNG chạy; máy nhường (false) → luồng cũ y nguyên.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../src/shared/database/prisma-client.js', () => ({ prisma: {} }));
vi.mock('../../../../src/modules/ai/agent/noi-zalo/gui-zalo.js', () => ({
  timDich: vi.fn(async () => ({ accountId: 'a1', threadId: 't1', threadType: 1, zaloUid: 'bot-uid' })),
  guiTin: vi.fn(async () => {}),
  guiAnh: vi.fn(async () => {}),
  guiFile: vi.fn(async () => {}),
  ghiAnhTam: vi.fn(async () => '/tmp/x.png'),
}));
vi.mock('../../../../src/modules/ai/agent/noi-zalo/llm.js', () => ({
  dungGenerate: vi.fn(async () => async () => ({
    text: 'ok', toolCalls: [], stopReason: 'end_turn', raw: null,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  })),
}));
vi.mock('../../../../src/modules/ai/agent/agent-operator-service.js', () => ({
  laNhanVienSync: vi.fn(() => true),
}));
vi.mock('../../../../src/modules/ai/agent/noi-zalo/du-lieu.js', () => ({
  layOdoo: vi.fn(() => ({})),
  layAnhClient: vi.fn(() => null),
  timTriThuc: vi.fn(async () => null),
  layLichSu: vi.fn(async () => []),
  seqTuMessageId: vi.fn(() => 1),
  coTinKhachMoiHon: vi.fn(async () => false),
}));
vi.mock('../../../../src/modules/ai/agent/staff-agent.js', () => ({
  chayLenhNhanVien: vi.fn(async () => ({
    trangThai: 'xong', traLoi: 'từ agent thường', log: [],
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  })),
}));
vi.mock('../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js', () => ({
  xuLyGomDon: vi.fn(async () => true),
}));

import { xuLyTinNhanVien } from '../../../../src/modules/ai/agent/noi-zalo/luong-nhan-vien.js';
import { xuLyGomDon } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import { chayLenhNhanVien } from '../../../../src/modules/ai/agent/staff-agent.js';
import { guiTin } from '../../../../src/modules/ai/agent/noi-zalo/gui-zalo.js';

const ctx = {
  orgId: 'o1', bizName: 'Shop', conversationId: 'c1', messageId: 'm1',
  content: 'lên đơn cho anh Hưng 10 cái nguồn NB nhé',
  senderUid: 'nv-1', isSelf: false, laNhom: false, daTagBot: false,
};

let goc: NodeJS.ProcessEnv;
beforeEach(() => {
  goc = { ...process.env };
  process.env.AI_AGENT_NHANVIEN = '1';
  process.env.ODOO_URL = 'http://localhost:8069';
  process.env.ODOO_DB = 'db';
  process.env.ODOO_USERNAME = 'u';
  process.env.ODOO_PASSWORD = 'p';
  vi.clearAllMocks();
});
afterEach(() => { process.env = goc; });

describe('wiring máy gom đơn trong xuLyTinNhanVien', () => {
  it('máy nhận (true) → agent thường KHÔNG chạy', async () => {
    vi.mocked(xuLyGomDon).mockResolvedValueOnce(true);
    expect(await xuLyTinNhanVien(ctx)).toBe(true);
    expect(xuLyGomDon).toHaveBeenCalledTimes(1);
    const [, thamSo] = vi.mocked(xuLyGomDon).mock.calls[0];
    expect(thamSo).toMatchObject({ orgId: 'o1', conversationId: 'c1', cau: expect.stringContaining('lên đơn') });
    expect(chayLenhNhanVien).not.toHaveBeenCalled();
  });

  it('máy nhường (false) → agent thường chạy, trả lời được gửi', async () => {
    vi.mocked(xuLyGomDon).mockResolvedValueOnce(false);
    expect(await xuLyTinNhanVien(ctx)).toBe(true);
    expect(chayLenhNhanVien).toHaveBeenCalledTimes(1);
    expect(vi.mocked(guiTin).mock.calls.some((c) => c[1] === 'từ agent thường')).toBe(true);
  });

  it('máy NÉM lỗi → nhân viên vẫn được báo, không im lặng', async () => {
    vi.mocked(xuLyGomDon).mockRejectedValueOnce(new Error('nổ thử'));
    expect(await xuLyTinNhanVien(ctx)).toBe(true);
    expect(vi.mocked(guiTin).mock.calls.some((c) => String(c[1]).includes('Bot gặp lỗi'))).toBe(true);
  });
});
