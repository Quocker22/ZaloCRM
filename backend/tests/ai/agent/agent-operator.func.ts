// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: nhận diện nhân viên qua bảng DB (spec 06/08/2026).
//
// Bug gốc: env cứng → nhân viên mới (Trần Hưng) bị xử như khách. Bảng DB +
// cache RAM thay env; env vẫn đọc song song (tương thích ngược). Cổng bảo mật
// GIỮ đồng bộ — test khoá cả hai mặt: nhận đúng nhân viên, chặn đúng khách.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/shared/database/prisma-client.js', () => ({
  prisma: { agentOperator: { findMany: vi.fn() } },
}));

import { prisma } from '../../../src/shared/database/prisma-client.js';
import {
  laNhanVienSync, napCache, xoaCache,
} from '../../../src/modules/ai/agent/agent-operator-service.js';
import { nhanDienLenhNhanVien } from '../../../src/modules/ai/agent/staff-command.js';

const findMany = vi.mocked(prisma.agentOperator.findMany);

let goc: NodeJS.ProcessEnv;
beforeEach(() => {
  goc = { ...process.env };
  delete process.env.AI_AGENT_UID_NHANVIEN;
  findMany.mockReset();
  xoaCache('org-1');
});
afterEach(() => { process.env = goc; });

describe('laNhanVienSync — hợp nhất DB + env', () => {
  it('UID trong bảng DB (đã nạp cache) → nhân viên', async () => {
    findMany.mockResolvedValue([{ zaloUid: 'uid-nv-1' }] as never);
    await napCache('org-1');

    expect(laNhanVienSync('org-1', 'uid-nv-1')).toBe(true);
    expect(laNhanVienSync('org-1', 'uid-la')).toBe(false);
  });

  it('UID trong ENV (không trong DB) → vẫn nhân viên (tương thích ngược)', async () => {
    process.env.AI_AGENT_UID_NHANVIEN = 'uid-env';
    findMany.mockResolvedValue([] as never);
    await napCache('org-1');

    expect(laNhanVienSync('org-1', 'uid-env')).toBe(true);
  });

  it('uid rỗng/null → false, không nổ', () => {
    expect(laNhanVienSync('org-1', null)).toBe(false);
    expect(laNhanVienSync('org-1', '')).toBe(false);
    expect(laNhanVienSync('org-1', undefined)).toBe(false);
  });

  it('cách ly theo ORG — nhân viên org này không phải nhân viên org kia', async () => {
    findMany.mockResolvedValue([{ zaloUid: 'uid-a' }] as never);
    await napCache('org-1');
    findMany.mockResolvedValue([] as never);
    await napCache('org-2');

    expect(laNhanVienSync('org-1', 'uid-a')).toBe(true);
    expect(laNhanVienSync('org-2', 'uid-a')).toBe(false);
  });

  it('xoaCache → lần gọi sau nạp lại (admin thao tác có hiệu lực NGAY)', async () => {
    findMany.mockResolvedValue([] as never);
    await napCache('org-1');
    expect(laNhanVienSync('org-1', 'uid-moi')).toBe(false);

    // Admin gán uid-moi → DB có, xoaCache → lần sau nạp thấy.
    findMany.mockResolvedValue([{ zaloUid: 'uid-moi' }] as never);
    xoaCache('org-1');
    await napCache('org-1');
    expect(laNhanVienSync('org-1', 'uid-moi')).toBe(true);
  });

  it('DB nạp LỖI → giữ cache cũ, không để nhân viên mất quyền vì blip DB', async () => {
    findMany.mockResolvedValue([{ zaloUid: 'uid-nv' }] as never);
    await napCache('org-1');
    expect(laNhanVienSync('org-1', 'uid-nv')).toBe(true);

    // Blip DB
    findMany.mockRejectedValue(new Error('db sập'));
    await napCache('org-1');
    // Cache cũ vẫn còn → uid-nv vẫn là nhân viên.
    expect(laNhanVienSync('org-1', 'uid-nv')).toBe(true);
  });
});

describe('cổng bảo mật — dùng laNhanVien thay env', () => {
  it('nhân viên (laNhanVien=true) nhắn không tag ở 1-1 → là lệnh', () => {
    const lenh = nhanDienLenhNhanVien({
      content: 'báo cáo tháng này', isSelf: false, senderUid: 'uid-nv',
      laNhanVien: (u) => u === 'uid-nv',
    });
    expect(lenh).not.toBeNull();
  });

  it('KHÁCH lạ (laNhanVien=false, không env) → null, dù gõ @bot', () => {
    const lenh = nhanDienLenhNhanVien({
      content: '@bot lên đơn 1000 cái', isSelf: false, senderUid: 'khach',
      laNhanVien: () => false,
    });
    expect(lenh).toBeNull();
  });

  it('không truyền laNhanVien → chỉ env (test cũ + luồng thiếu orgId vẫn chạy)', () => {
    process.env.AI_AGENT_UID_NHANVIEN = 'uid-env';
    expect(nhanDienLenhNhanVien({ content: 'x', isSelf: false, senderUid: 'uid-env' })).not.toBeNull();
    expect(nhanDienLenhNhanVien({ content: 'x', isSelf: false, senderUid: 'la' })).toBeNull();
  });

  it('nick shop (isSelf) vẫn qua cổng không cần laNhanVien', () => {
    expect(nhanDienLenhNhanVien({ content: '@bot giá P10', isSelf: true })).not.toBeNull();
  });
});
