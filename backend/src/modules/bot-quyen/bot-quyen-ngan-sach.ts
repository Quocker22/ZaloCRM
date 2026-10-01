// SPDX-License-Identifier: AGPL-3.0-or-later
// QUYỀN BOT (docs/77 §8b-an-toàn, D7) — bộ đếm NGÂN SÁCH NGÀY của các lời gọi Zalo do tính năng Quyền bot tự làm
// (đọc danh sách nhóm = group_read, đọc hồ sơ = query, tìm SĐT = friend_lookup), theo nick + loại, ngày UTC (như
// zalo-rate-limiter). Bản trước đếm trong RAM ⇒ khởi động lại (deploy, OOM) là đếm lại từ 0 ⇒ một ngày có thể tiêu gấp
// nhiều lần phần được phép. Nay: có REDIS_URL ⇒ Redis (hash `bq:ns:<nick>:<loai>` → {<ngày>: số}, sống 2 ngày — cùng kiểu
// khoá `rl:daily:*` của zalo-rate-limiter); không có / Redis lỗi ⇒ RAM (trần của rate-limiter vẫn là chốt chặn cuối).
//
// NHỊP (burst): `choNhip(nick, loai, burst, cuaSoMs)` giữ khoảng cách tối thiểu giữa hai lời gọi CÙNG nick + loại =
// cuaSo / floor(burst/2) ⇒ tính năng này dùng tối đa NỬA trần burst (query 30/30 s ⇒ 1 lần/2 s; group_read 20/30 s ⇒
// 1 lần/3 s; friend_lookup 15/30 s ⇒ 1 lần/~4,3 s) — nửa kia cho chat / quét group / chiến dịch.
import type { RedisClient } from '../../shared/redis-client.js';

export interface KhoDem {
  lay(khoa: string, ngay: string): Promise<number>;
  tang(khoa: string, ngay: string): Promise<number>;
}

const HAN_KHOA_S = 86400 * 2;

/** Kho RAM (một tiến trình). */
export function khoRam(): KhoDem & { xoa(loai?: readonly string[]): void } {
  const m = new Map<string, number>();
  return {
    async lay(k, ngay) { return m.get(`${k}|${ngay}`) ?? 0; },
    async tang(k, ngay) { const v = (m.get(`${k}|${ngay}`) ?? 0) + 1; m.set(`${k}|${ngay}`, v); return v; },
    xoa(loai) {
      if (!loai) { m.clear(); return; }
      for (const k of [...m.keys()]) if (loai.some((l) => k.includes(`:${l}|`))) m.delete(k);
    },
  };
}

/** Kho Redis — hỏng thì rơi về `duPhong` (không làm hỏng người gọi). */
export function khoRedis(r: Pick<RedisClient, 'hget' | 'hincrby' | 'expire'>, duPhong: KhoDem): KhoDem {
  return {
    async lay(k, ngay) {
      try {
        const v = await r.hget(k, ngay);
        return v ? parseInt(v, 10) || 0 : 0;
      } catch { return duPhong.lay(k, ngay); }
    },
    async tang(k, ngay) {
      try {
        const v = await r.hincrby(k, ngay, 1);
        await r.expire(k, HAN_KHOA_S);
        return Number(v);
      } catch { return duPhong.tang(k, ngay); }
    },
  };
}

const ram = khoRam();
let kho: KhoDem | null = null;
let khoTest: KhoDem | null = null;

async function layKho(): Promise<KhoDem> {
  if (khoTest) return khoTest;
  if (kho) return kho;
  try {
    const { getRedis } = await import('../../shared/redis-client.js');
    const r = await getRedis();
    kho = r ? khoRedis(r, ram) : ram;
  } catch {
    kho = ram;
  }
  return kho;
}

export function khoaNganSach(nick: string, loai: string): string {
  return `bq:ns:${nick}:${loai}`;
}

export function ngayUtc(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Số lần đã dùng hôm nay (UTC) của nick cho loại này. */
export async function daDungHomNay(nick: string, loai: string, luc: Date = new Date()): Promise<number> {
  return (await layKho()).lay(khoaNganSach(nick, loai), ngayUtc(luc));
}

/** Ghi thêm một lần dùng; trả số mới. */
export async function ghiDung(nick: string, loai: string, luc: Date = new Date()): Promise<number> {
  return (await layKho()).tang(khoaNganSach(nick, loai), ngayUtc(luc));
}

// ── Nhịp ────────────────────────────────────────────────────────────────────
const lanCuoi = new Map<string, number>();
let ngu: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
let dongHo: () => number = () => Date.now();

/** Khoảng cách tối thiểu giữa hai lời gọi để dùng tối đa NỬA trần burst. THUẦN. */
export function khoangNhip(burst: number, cuaSoMs: number): number {
  return Math.ceil(Math.max(1, cuaSoMs) / Math.max(1, Math.floor(Math.max(1, burst) / 2)));
}

/** Chờ tới lượt (nick, loại) theo nhịp nửa-burst, rồi giữ chỗ lượt này. */
export async function choNhip(nick: string, loai: string, burst: number, cuaSoMs: number): Promise<void> {
  const k = `${nick}|${loai}`;
  const khoang = khoangNhip(burst, cuaSoMs);
  const truoc = lanCuoi.get(k);
  const bay = dongHo();
  const den = truoc === undefined ? bay : Math.max(bay, truoc + khoang);
  lanCuoi.set(k, den);
  if (den > bay) await ngu(den - bay);
}

/**
 * Chỉ cho test: kho đếm (null = thật), hàm ngủ + đồng hồ của nhịp (null = thật). Xoá bộ đếm RAM của các `loai` và mốc
 * nhịp của các `nhip` (không nêu ⇒ xoá hết). Hai tập TÁCH nhau (P3-2): loại ngân sách (vd `dt_query`) KHÔNG trùng tên loại
 * nhịp (`query` — tên category của rate limiter); bản trước xoá nhịp theo `loai` ⇒ mốc `<nick>|query` sống qua mọi lần
 * đặt lại ⇒ test sau chờ nhịp của test trước.
 */
export function _datNganSachChoTest(o: {
  kho?: KhoDem | null; ngu?: ((ms: number) => Promise<void>) | null; dongHo?: (() => number) | null;
  loai?: readonly string[]; nhip?: readonly string[];
} = {}): void {
  if (o.kho !== undefined) khoTest = o.kho;
  if (o.ngu !== undefined) ngu = o.ngu ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  if (o.dongHo !== undefined) dongHo = o.dongHo ?? (() => Date.now());
  ram.xoa(o.loai);
  const nhip = o.nhip ?? (o.loai ? [] : null);
  for (const k of [...lanCuoi.keys()]) if (!nhip || nhip.some((l) => k.endsWith(`|${l}`))) lanCuoi.delete(k);
}
