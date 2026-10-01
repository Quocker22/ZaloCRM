// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot (docs/77 §8b-an-toàn, D7) — bộ đếm ngân sách ngày BỀN qua khởi động lại (Redis) + nhịp nửa-burst; mọi model
// Bot* có orgId nằm trong ORG_SCOPED_MODELS (tenant-guard).
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  khoRam, khoRedis, khoangNhip, choNhip, daDungHomNay, ghiDung, khoaNganSach, _datNganSachChoTest,
} from '../src/modules/bot-quyen/bot-quyen-ngan-sach.js';
import { ORG_SCOPED_MODELS } from '../src/shared/tenant/org-scoped-models.js';

/** Redis giả: một "máy chủ" (Map) sống qua các tiến trình. */
function redisGia(store = new Map<string, Map<string, string>>()) {
  const ttl = new Map<string, number>();
  return {
    store, ttl,
    async hget(k: string, f: string) { return store.get(k)?.get(f) ?? null; },
    async hincrby(k: string, f: string, n: number) {
      const h = store.get(k) ?? new Map<string, string>();
      const v = Number(h.get(f) ?? 0) + n;
      h.set(f, String(v));
      store.set(k, h);
      return v;
    },
    async expire(k: string, s: number) { ttl.set(k, s); return 1; },
  };
}

afterEach(() => _datNganSachChoTest({ kho: null, ngu: null, dongHo: null }));

describe('ngân sách ngày (D7)', () => {
  it('Redis: khởi động lại (kho mới trên CÙNG Redis) KHÔNG đếm lại từ 0; khoá sống 2 ngày', async () => {
    const r = redisGia();
    const k = khoaNganSach('nick-vt', 'dt_query');
    const truoc = khoRedis(r as never, khoRam());
    await truoc.tang(k, '2026-09-30');
    await truoc.tang(k, '2026-09-30');
    const sau = khoRedis(r as never, khoRam()); // "tiến trình mới"
    expect(await sau.lay(k, '2026-09-30')).toBe(2);
    expect(await sau.lay(k, '2026-10-01')).toBe(0);
    expect(r.ttl.get(k)).toBe(172800);
  });

  it('Redis lỗi ⇒ rơi về RAM, không ném', async () => {
    const hong = { hget: async () => { throw new Error('mất Redis'); }, hincrby: async () => { throw new Error('mất Redis'); }, expire: async () => 1 };
    const kho = khoRedis(hong as never, khoRam());
    expect(await kho.tang('k', 'd')).toBe(1);
    expect(await kho.lay('k', 'd')).toBe(1);
  });

  it('daDungHomNay / ghiDung đi qua kho đang dùng; xoá theo loại chỉ xoá loại đó', async () => {
    const r = redisGia();
    _datNganSachChoTest({ kho: khoRedis(r as never, khoRam()) });
    await ghiDung('n1', 'dt_query');
    expect(await daDungHomNay('n1', 'dt_query')).toBe(1);
    _datNganSachChoTest({ kho: null });
    await ghiDung('n1', 'dt_query');
    await ghiDung('n1', 'ds_group_read');
    _datNganSachChoTest({ loai: ['dt_query'] });
    expect(await daDungHomNay('n1', 'dt_query')).toBe(0);
    expect(await daDungHomNay('n1', 'ds_group_read')).toBe(1);
  });
});

describe('nhịp nửa-burst (D7)', () => {
  it('khoangNhip: query 30/30 s ⇒ 2 s; group_read 20/30 s ⇒ 3 s; friend_lookup 15/30 s ⇒ ~4,3 s', () => {
    expect(khoangNhip(30, 30_000)).toBe(2000);
    expect(khoangNhip(20, 30_000)).toBe(3000);
    expect(khoangNhip(15, 30_000)).toBe(4286);
    expect(khoangNhip(1, 30_000)).toBe(30_000);
  });

  it('choNhip: lời gọi liền nhau cùng nick+loại cách nhau ≥ khoảng; nick / loại khác không chờ nhau', async () => {
    let bay = 1_000_000;
    const ngu: number[] = [];
    _datNganSachChoTest({ dongHo: () => bay, ngu: async (ms) => { ngu.push(ms); bay += ms; } });
    await choNhip('n1', 'query', 30, 30_000);
    await choNhip('n1', 'query', 30, 30_000);
    await choNhip('n1', 'query', 30, 30_000);
    await choNhip('n2', 'query', 30, 30_000);
    await choNhip('n1', 'friend_lookup', 15, 30_000);
    expect(ngu).toEqual([2000, 2000]);
    // 30 lời gọi query liền nhau trải ≥ 58 s ⇒ trong mọi cửa sổ 30 s không quá 15 (nửa burst)
    _datNganSachChoTest({ dongHo: () => bay, ngu: async (ms) => { bay += ms; } });
    const moc: number[] = [];
    for (let i = 0; i < 30; i++) { await choNhip('n3', 'query', 30, 30_000); moc.push(bay); }
    for (const t of moc) expect(moc.filter((x) => x >= t && x < t + 30_000).length).toBeLessThanOrEqual(15);
  });
});

describe('đặt lại cho test (P3-2)', () => {
  it('_datZaloDanhTinhChoTest xoá MỐC NHỊP query/friend_lookup (tên khác loại ngân sách dt_query/dt_sdt) ⇒ test sau không chờ nhịp test trước', async () => {
    const { _datZaloDanhTinhChoTest } = await import('../src/modules/bot-quyen/bot-quyen-danh-tinh.js');
    let bay = 5_000_000;
    const ngu: number[] = [];
    _datNganSachChoTest({ dongHo: () => bay, ngu: async (ms) => { ngu.push(ms); bay += ms; } });
    await choNhip('nx', 'query', 30, 30_000);
    await choNhip('nx', 'friend_lookup', 15, 30_000);
    _datZaloDanhTinhChoTest(null);
    await choNhip('nx', 'query', 30, 30_000);
    await choNhip('nx', 'friend_lookup', 15, 30_000);
    expect(ngu).toEqual([]);
  });

  it('_datNganSachChoTest({ loai }) KHÔNG xoá nhịp của loại khác; { nhip } chỉ xoá nhịp nêu tên', async () => {
    let bay = 9_000_000;
    const ngu: number[] = [];
    _datNganSachChoTest({ dongHo: () => bay, ngu: async (ms) => { ngu.push(ms); bay += ms; } });
    await choNhip('ny', 'query', 30, 30_000);
    await choNhip('ny', 'group_read', 20, 30_000);
    _datNganSachChoTest({ loai: ['ds_group_read'] });
    await choNhip('ny', 'group_read', 20, 30_000);
    expect(ngu).toEqual([3000]);
    _datNganSachChoTest({ loai: [], nhip: ['query'] });
    await choNhip('ny', 'query', 30, 30_000);
    expect(ngu).toEqual([3000]);
  });
});

describe('tenant-guard (D7)', () => {
  it('MỌI model Bot* có orgId trong schema nằm trong ORG_SCOPED_MODELS', () => {
    const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
    const models = [...schema.matchAll(/^model (Bot\w+) \{([\s\S]*?)^\}/gm)]
      .filter((m) => /^\s+orgId\s/m.test(m[2])).map((m) => m[1]);
    expect(models).toContain('BotQuyenDanhTinh');
    expect(models.filter((m) => !ORG_SCOPED_MODELS.has(m))).toEqual([]);
  });
});
