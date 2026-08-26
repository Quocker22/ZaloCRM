// SPDX-License-Identifier: AGPL-3.0-or-later
// Ca thật 09:51:56–09:52:29 26/08: Minh Anh thêm chị Mỹ làm nhân viên (route
// gọi xoaCache → cache bị XOÁ SẠCH) → 33s sau anh Quốc (nhân viên từ 08/08)
// nhắn "@bot cho công nợ anh Anh Quế…" → cổng đồng bộ thấy cache trống, nạp
// nền nhưng trả false NGAY → tin bị vứt im lặng ("không qua cổng nhận lệnh").
// Anh Quốc: "sao không thấy trả lời?".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/shared/database/prisma-client.js', () => ({
  prisma: { agentOperator: { findMany: vi.fn() } },
}));

import { prisma } from '../../../src/shared/database/prisma-client.js';
import {
  laNhanVienSync, napCache, xoaCache, themUidVaoCache, boUidKhoiCache,
} from '../../../src/modules/ai/agent/agent-operator-service.js';

const findMany = vi.mocked(prisma.agentOperator.findMany);
let goc: NodeJS.ProcessEnv;
beforeEach(() => {
  goc = { ...process.env };
  delete process.env.AI_AGENT_UID_NHANVIEN;
  findMany.mockReset();
});
afterEach(() => { process.env = goc; });

describe('cache nhân viên không được lỡ tin khi vừa thêm/sửa nhân viên', () => {
  it('ca thật: thêm NV mới (xoaCache) → NV cũ hỏi ngay sau vẫn QUA cổng, và cache được nạp lại nền', async () => {
    findMany.mockResolvedValue([{ zaloUid: 'uid-quoc' }] as never);
    await napCache('org-1');
    expect(laNhanVienSync('org-1', 'uid-quoc')).toBe(true);

    xoaCache('org-1'); // route thêm nhân viên gọi
    const soLanNap = findMany.mock.calls.length;
    expect(laNhanVienSync('org-1', 'uid-quoc')).toBe(true); // TRƯỚC 26/08: false → tin bị vứt
    expect(findMany.mock.calls.length).toBe(soLanNap + 1);   // đã kích nạp nền
  });

  it('NV vừa thêm có hiệu lực NGAY (không đợi 60s TTL / nạp nền)', async () => {
    findMany.mockResolvedValue([{ zaloUid: 'uid-quoc' }] as never);
    await napCache('org-1');
    expect(laNhanVienSync('org-1', 'uid-my')).toBe(false);
    themUidVaoCache('org-1', 'uid-my');
    expect(laNhanVienSync('org-1', 'uid-my')).toBe(true);
  });

  it('NV bị tắt/xoá thì ra khỏi cổng NGAY (bảo mật không được trễ)', async () => {
    findMany.mockResolvedValue([{ zaloUid: 'uid-cu' }] as never);
    await napCache('org-1');
    boUidKhoiCache('org-1', 'uid-cu');
    expect(laNhanVienSync('org-1', 'uid-cu')).toBe(false);
  });

  it('chưa từng có cache (mới khởi động) → vẫn false như cũ, không nổ', () => {
    findMany.mockResolvedValue([] as never);
    expect(laNhanVienSync('org-moi', 'ai-do')).toBe(false);
  });
});
