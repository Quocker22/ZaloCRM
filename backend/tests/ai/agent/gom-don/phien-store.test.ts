// SPDX-License-Identifier: AGPL-3.0-or-later
// Store phiên gom đơn — TTL 15 phút, quá hạn coi như không có và dọn luôn.
import { describe, it, expect } from 'vitest';
import { docPhien, luuPhien, xoaPhien } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/phien-store.js';

function fakePrisma() {
  const rows = new Map<string, { orgId: string; conversationId: string; slots: unknown; hetHan: Date }>();
  return {
    rows,
    phienGomDon: {
      findUnique: async ({ where }: { where: { conversationId: string } }) =>
        rows.get(where.conversationId) ?? null,
      upsert: async ({ where, create }: { where: { conversationId: string }; create: never }) => {
        rows.set(where.conversationId, create);
        return create;
      },
      deleteMany: async ({ where }: { where: { conversationId: string } }) => {
        rows.delete(where.conversationId);
        return { count: 1 };
      },
    },
  };
}

describe('phien-store', () => {
  it('lưu rồi đọc lại nguyên vẹn, hạn ~15 phút', async () => {
    const db = fakePrisma();
    await luuPhien(db as never, {
      orgId: 'o1', conversationId: 'c1',
      phien: { khachTuKhoa: 'Hưng', dong: [{ tuKhoa: 'nguồn NB', sl: 10 }] },
    });
    const p = await docPhien(db as never, 'c1');
    expect(p?.khachTuKhoa).toBe('Hưng');
    expect(p?.dong[0].sl).toBe(10);
    const hetHan = db.rows.get('c1')!.hetHan.getTime() - Date.now();
    expect(hetHan).toBeGreaterThan(14 * 60_000);
    expect(hetHan).toBeLessThan(16 * 60_000);
  });

  it('quá hạn → trả null và xoá dòng', async () => {
    const db = fakePrisma();
    db.rows.set('c1', {
      orgId: 'o1', conversationId: 'c1',
      slots: { khachTuKhoa: 'Hưng', dong: [] }, hetHan: new Date(Date.now() - 1000),
    });
    expect(await docPhien(db as never, 'c1')).toBeNull();
    expect(db.rows.has('c1')).toBe(false);
  });

  it('xoaPhien dọn dòng; docPhien hội thoại lạ → null', async () => {
    const db = fakePrisma();
    await luuPhien(db as never, { orgId: 'o1', conversationId: 'c1', phien: { khachTuKhoa: null, dong: [] } });
    await xoaPhien(db as never, 'c1');
    expect(await docPhien(db as never, 'c1')).toBeNull();
    expect(await docPhien(db as never, 'khong-co')).toBeNull();
  });
});
