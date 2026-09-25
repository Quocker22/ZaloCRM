// SPDX-License-Identifier: AGPL-3.0-or-later
// Đối chiếu TS ↔ SQL cho mức độ log app (hợp đồng hàng đợi/huỷ v5 §5 + §8.9): chạy NGUYÊN VĂN
// migration 20260925200000_print_app_logs_muc_do trên Postgres THẬT, trên đúng bảng mẫu mà
// muc-do-app.test.ts dùng cho hàm TS, rồi so từng dòng: SQL == TS == mong đợi.
//
// CẦN DB: đặt CO_DB_TEST=1 + DATABASE_URL (máy trần → SKIP có chủ đích, xem helpers/can-db.ts).
// AN TOÀN: chỉ tạo + xoá một schema RIÊNG tên "kiem_muc_do_<ngẫu nhiên>" (search_path trỏ vào
// đó) — không bao giờ đụng bảng print_app_logs thật của schema public.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { describeCanDb } from '../../helpers/can-db.js';
import { phanLoaiMucDoApp } from '../../../src/modules/ai/may-in/nhat-ky-app.js';
import { MAU_MUC_DO_APP } from './mau-muc-do-app.js';

const MIGRATION = new URL('../../../prisma/migrations/20260925200000_print_app_logs_muc_do/migration.sql', import.meta.url);

describeCanDb('migration muc_do — backfill SQL khớp phanLoaiMucDoApp (Postgres thật)', () => {
  const schema = `kiem_muc_do_${randomBytes(6).toString('hex')}`;
  let db: pg.Client;

  beforeAll(async () => {
    expect(schema).toMatch(/^kiem_muc_do_[0-9a-f]{12}$/);
    db = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`SET search_path TO "${schema}"`);
    // Đúng các cột migration đụng tới (bảng thật có thêm cột — không ảnh hưởng câu lệnh).
    await db.query(`CREATE TABLE "print_app_logs" (
      "id" TEXT PRIMARY KEY, "org_id" TEXT NOT NULL, "luc" TIMESTAMP(3) NOT NULL,
      "su_kien" TEXT NOT NULL, "noi_dung" TEXT NOT NULL)`);
    for (const [i, m] of MAU_MUC_DO_APP.entries()) {
      await db.query('INSERT INTO "print_app_logs" (id, org_id, luc, su_kien, noi_dung) VALUES ($1, $2, now(), $3, $4)', [
        `d${i}`, 'org1', m.suKien, m.noiDung,
      ]);
    }
  });

  afterAll(async () => {
    if (!db) return;
    await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await db.end();
  });

  async function docMuc(): Promise<Map<string, string>> {
    const r = await db.query<{ id: string; muc_do: string }>('SELECT id, muc_do FROM "print_app_logs"');
    return new Map(r.rows.map((x) => [x.id, x.muc_do]));
  }

  it('chạy migration: mỗi dòng mẫu SQL == TS == mong đợi', async () => {
    await db.query(readFileSync(MIGRATION, 'utf8'));
    const muc = await docMuc();
    const lech = MAU_MUC_DO_APP.flatMap((m, i) => {
      const sql = muc.get(`d${i}`);
      const ts = phanLoaiMucDoApp(m.suKien, m.noiDung);
      return sql === ts && ts === m.mucDo ? [] : [{ vi: m.vi, suKien: m.suKien, noiDung: m.noiDung, sql, ts, mong: m.mucDo }];
    });
    expect(lech).toEqual([]);
  });

  it('chạy lại migration (IF NOT EXISTS + chỉ ghi dòng lệch): không lỗi, kết quả không đổi; có index mới', async () => {
    const truoc = await docMuc();
    await db.query(readFileSync(MIGRATION, 'utf8'));
    expect(await docMuc()).toEqual(truoc);
    const idx = await db.query(`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'print_app_logs'`, [schema]);
    expect(idx.rows.map((r) => r.indexname)).toContain('print_app_logs_org_id_muc_do_luc_idx');
  });

  it('dòng mới không truyền muc_do → mặc định thong_tin (code cũ trong lúc deploy)', async () => {
    await db.query(`INSERT INTO "print_app_logs" (id, org_id, luc, su_kien, noi_dung) VALUES ('moi', 'org1', now(), 'su_co', 'x')`);
    expect((await docMuc()).get('moi')).toBe('thong_tin');
    await db.query(readFileSync(MIGRATION, 'utf8')); // chạy lại → sửa đúng
    expect((await docMuc()).get('moi')).toBe('loi');
  });
});
