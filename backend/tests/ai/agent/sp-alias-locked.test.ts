// SPDX-License-Identifier: AGPL-3.0-or-later
// NHÓM C (15/08) — cột `locked` (học TencentDB wiki locked): admin sửa alias
// tay thì bot HẾT quyền học đè. Không có nó, một lần bot học lại là mất bản
// người sửa — đúng vết alias "trắng ấm" 13/08.
import { describe, it, expect, vi } from 'vitest';
import { ghiAliasSp, type PrismaSpAlias } from '../../../src/modules/ai/agent/sp-alias.js';

function fakePrisma(coSan: { locked: boolean } | null) {
  const upsert = vi.fn(async () => ({}));
  const prisma = {
    spAlias: {
      findUnique: vi.fn(async () => (coSan ? { productId: 1, demDung: 1, ...coSan } : null)),
      upsert,
    },
  } as unknown as PrismaSpAlias;
  return { prisma, upsert };
}

describe('ghiAliasSp tôn trọng locked', () => {
  it('alias locked → đường học tự động BỎ QUA, không đè', async () => {
    const { prisma, upsert } = fakePrisma({ locked: true });
    await ghiAliasSp(prisma, { orgId: 'o1', tuKhoa: '3b 6214 trắng ấm', productId: 999, tenSp: 'X' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('chưa locked (hoặc chưa có) → học bình thường', async () => {
    const a = fakePrisma({ locked: false });
    await ghiAliasSp(a.prisma, { orgId: 'o1', tuKhoa: 'led hắt 6313', productId: 7, tenSp: 'Saso' });
    expect(a.upsert).toHaveBeenCalledTimes(1);

    const b = fakePrisma(null);
    await ghiAliasSp(b.prisma, { orgId: 'o1', tuKhoa: 'led hắt 6313', productId: 7, tenSp: 'Saso' });
    expect(b.upsert).toHaveBeenCalledTimes(1);
  });
});
