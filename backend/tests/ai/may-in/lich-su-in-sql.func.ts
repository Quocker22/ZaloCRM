// SPDX-License-Identifier: AGPL-3.0-or-later
// Lịch sử in trên Postgres THẬT + Prisma client THẬT: câu truy vấn Prisma của lich-su-in.ts
// (orderBy mảng, count, con trỏ theo updated_at) chạy đúng trên bảng dựng NGUYÊN VĂN từ các
// migration máy in, và index mới 20260926150000_print_jobs_lich_su_idx dùng được cho nó.
// Bản giả (lich-su-in.func.ts) không bắt được lỗi dạng câu Prisma — file này bắt.
//
// CẦN DB: đặt CO_DB_TEST=1 + DATABASE_URL (máy trần → SKIP có chủ đích, xem helpers/can-db.ts).
// AN TOÀN: chỉ tạo + xoá một schema RIÊNG tên "kiem_lich_su_<ngẫu nhiên>" — không bao giờ đụng
// bảng print_jobs thật của schema public.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { describeCanDb } from '../../helpers/can-db.js';
import { timLichSuIn, demLichSuIn, type PrismaLichSu } from '../../../src/modules/ai/may-in/lich-su-in.js';

const MIGRATIONS = [
  '20260824110000_print_jobs',
  '20260910120000_print_agents',
  '20260925090000_print_logs',
  '20260926150000_print_jobs_lich_su_idx',
].map((ten) => new URL(`../../../prisma/migrations/${ten}/migration.sql`, import.meta.url));

const BAY_GIO = Date.parse('2026-09-26T08:00:00.000Z');
const NGAY = 24 * 3600 * 1000;
const TOKEN_HN = 'token-may-ha-noi-0123456789abcdef';
const GIO = 3600 * 1000;
/** Chuỗi ISO UTC — Postgres BỎ phần múi giờ khi ghi vào cột TIMESTAMP không múi giờ ⇒ lưu đúng giờ UTC. */
const utc = (ms: number): string => new Date(ms).toISOString();

describeCanDb('lịch sử in — Prisma thật trên Postgres thật', () => {
  const schema = `kiem_lich_su_${randomBytes(6).toString('hex')}`;
  let db: pg.Client;
  let prisma: PrismaClient;

  beforeAll(async () => {
    expect(schema).toMatch(/^kiem_lich_su_[0-9a-f]{12}$/);
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    // (giám sát vòng 2) Cột TIMESTAMP(3) KHÔNG múi giờ, Prisma đọc/ghi coi là UTC. Bản trước đưa Date
    // của JS vào — node-pg đổi sang giờ MÁY (+07:00 ở VN) rồi Postgres cắt theo TimeZone phiên: mốc
    // 30 ngày chỉ đúng khi hai bên tình cờ cùng múi. Giờ: phiên UTC + chuỗi ISO UTC (utc()).
    await db.query(`SET TIME ZONE 'UTC'`);
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET search_path TO "${schema}"`);
    for (const m of MIGRATIONS) await db.query(readFileSync(m, 'utf8'));
    await db.query(
      `INSERT INTO print_agents (id, org_id, ten, token, updated_at) VALUES ('mHN', 'o1', 'Máy HN', $1, now())`,
      [TOKEN_HN],
    );
    const job = async (id: string, trangThai: string, capNhat: number, them: { org?: string; token?: string | null; loi?: string } = {}) =>
      db.query(
        `INSERT INTO print_jobs (id, org_id, hoa_don_id, so_hoa_don, report, trang_thai, loi_cuoi, agent_token, created_at, updated_at)
         VALUES ($1, $2, 1, $3, 'r', $4, $5, $6, $7, $8)`,
        [id, them.org ?? 'o1', `INV/${id}`, trangThai, them.loi ?? null, them.token === undefined ? TOKEN_HN : them.token,
          utc(BAY_GIO - 40 * NGAY), utc(BAY_GIO - capNhat)],
      );
    const cung = 5 * 60_000; // ba lệnh in xong CÙNG mili-giây
    await job('a', 'da_in', cung);
    await job('b', 'da_in', cung);
    await job('c', 'da_in', cung, { token: null });
    await job('d', 'da_in', NGAY);
    // Sát mép cửa sổ 30 ngày: lệch 1 giờ mỗi phía — sai múi giờ (7 giờ) là lọt/rơi nhầm.
    await job('bien-trong', 'da_in', 29 * NGAY + 23 * GIO);
    await job('bien-ngoai', 'da_in', 30 * NGAY + GIO);
    await job('cu', 'da_in', 31 * NGAY);
    await job('khac', 'da_in', 1000, { org: 'o2' });
    await job('h', 'da_huy', 2000, { loi: 'Đã huỷ bởi ZaloCRM (Chị Hoa)' });
    await job('bo', 'bo_qua', 3000);
    await db.query(
      `INSERT INTO print_logs (id, org_id, muc_do, loai, noi_dung, print_job_id, ten_khach, tu_khoa)
       VALUES ('l1', 'o1', 'thong_tin', 'da_in', 'x', 'a', 'Anh Lộc Beco', 'x')`,
    );
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }, { schema }) });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (!db) return;
    await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.end();
  });

  const deps = () => ({ prisma: prisma as unknown as PrismaLichSu, tokenMacDinh: TOKEN_HN, bayGio: () => BAY_GIO });

  it('mốc giờ lưu đúng UTC (không lệch múi giờ máy chạy test)', async () => {
    const r = await db.query(`SELECT updated_at::text AS t FROM print_jobs WHERE id = 'bien-trong'`);
    expect(r.rows[0].t).toBe('2026-08-27 09:00:00'); // 26/09 08:00 UTC − 29 ngày 23 giờ
  });

  it('Đã in: 30 ngày theo updated_at (29d23h VÀO, 30d1h RA), mới trước, con trỏ không mất/lặp khi trùng mili-giây, tên máy + tên khách', async () => {
    const dau = await timLichSuIn('o1', { trangThai: 'da_in', mayInId: null, truoc: null, gioiHan: 2 }, deps());
    expect(dau.tong).toBe(5);
    expect(dau.items.map((m) => m.id)).toEqual(['c', 'b']);
    const thay = dau.items.map((m) => m.id);
    const cacTrang = [dau];
    let con = dau.tiepTheo;
    while (con) {
      const [luc, id] = con.split('|');
      const trang = await timLichSuIn('o1', { trangThai: 'da_in', mayInId: null, truoc: { luc: new Date(luc), id }, gioiHan: 2 }, deps());
      expect(trang.tong).toBeNull();
      thay.push(...trang.items.map((m) => m.id));
      cacTrang.push(trang);
      con = trang.tiepTheo;
      expect(cacTrang.length).toBeLessThan(10);
    }
    expect(thay).toEqual(['c', 'b', 'a', 'd', 'bien-trong']);
    const a = cacTrang.flatMap((t) => t.items).find((m) => m.id === 'a')!;
    expect(a).toMatchObject({ tenKhach: 'Anh Lộc Beco', mayInId: 'mHN', mayInTen: 'Máy HN' });
    expect(dau.items[0]).toMatchObject({ id: 'c', mayInTen: 'Máy HN' }); // agent_token NULL = máy mặc định
    const mayHN = await timLichSuIn('o1', { trangThai: 'da_in', mayInId: 'mHN', truoc: null, gioiHan: 50 }, deps());
    expect(mayHN.tong).toBe(5);
    expect(mayHN.items.map((m) => m.id)).not.toContain('bien-ngoai');
  });

  it('Đã huỷ: chỉ da_huy (bo_qua không); đếm cả org', async () => {
    const huy = await timLichSuIn('o1', { trangThai: 'da_huy', mayInId: null, truoc: null, gioiHan: 50 }, deps());
    expect(huy.items.map((m) => [m.id, m.lyDo])).toEqual([['h', 'Đã huỷ bởi ZaloCRM (Chị Hoa)']]);
    expect(await demLichSuIn('o1', deps())).toMatchObject({ daIn: 5, daHuy: 1 });
  });

  it('index mới dùng được cho câu lọc 30 ngày + sắp xếp; trang 2+ có CẬN TRÊN trong Index Cond (planner bị cấm quét tuần tự)', async () => {
    await db.query('SET enable_seqscan = off');
    const dau = await db.query(
      `EXPLAIN SELECT id FROM print_jobs WHERE org_id = 'o1' AND trang_thai = 'da_in' AND updated_at >= $1
       ORDER BY updated_at DESC, id DESC LIMIT 51`,
      [utc(BAY_GIO - 30 * NGAY)],
    );
    // Dạng câu trang 2+ của taoWhereLichSu: cận trên đứng riêng + phân xử (updated_at, id) trong OR
    const sau = await db.query(
      `EXPLAIN SELECT id FROM print_jobs WHERE org_id = 'o1' AND trang_thai = 'da_in' AND updated_at >= $1
         AND updated_at <= $2 AND (updated_at < $2 OR (updated_at = $2 AND id < 'b'))
       ORDER BY updated_at DESC, id DESC LIMIT 51`,
      [utc(BAY_GIO - 30 * NGAY), utc(BAY_GIO - 5 * 60_000)],
    );
    await db.query('RESET enable_seqscan');
    const plan = (r: { rows: Array<Record<string, string>> }) => r.rows.map((x) => x['QUERY PLAN']).join('\n');
    expect(plan(dau)).toContain('print_jobs_org_id_trang_thai_updated_at_idx');
    expect(plan(sau)).toContain('print_jobs_org_id_trang_thai_updated_at_idx');
    expect(plan(sau)).toMatch(/Index Cond:.*updated_at <= /);
  });
});
