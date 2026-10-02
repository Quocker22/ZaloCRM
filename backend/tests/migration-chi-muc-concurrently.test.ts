// SPDX-License-Identifier: AGPL-3.0-or-later
// Rào cho chỉ mục RIÊNG PHẦN dựng bằng `CREATE INDEX CONCURRENTLY` trong migration (20260930210100_messages_idx_lien_ket,
// 20261002090600_messages_idx_client_echo, …). Prisma schema KHÔNG diễn tả được chỉ mục có WHERE ⇒ `prisma migrate dev`
// thấy chúng là "lệch" và tự sinh `DROP INDEX` trong migration mới. Test này:
//   1. mỗi file migration có CONCURRENTLY chỉ chứa câu CREATE INDEX CONCURRENTLY (thêm BEGIN/SET LOCAL… là hỏng CONCURRENTLY);
//   2. KHÔNG migration nào về sau DROP các chỉ mục đó (bắt migration `migrate dev` sinh ra mà quên xoá dòng DROP);
//   3. schema.prisma ghi tên từng chỉ mục trong chú thích của model — người sửa schema thấy cảnh báo ngay tại chỗ.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const THU_MUC = fileURLToPath(new URL('../prisma/migrations', import.meta.url));
const SCHEMA = readFileSync(fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)), 'utf8');

const migrations = readdirSync(THU_MUC)
  .filter((d) => existsSync(join(THU_MUC, d, 'migration.sql')))
  .sort()
  .map((d) => ({ ten: d, sql: readFileSync(join(THU_MUC, d, 'migration.sql'), 'utf8') }));

/** bỏ chú thích `-- …` để chỉ xét câu lệnh */
const boChuThich = (sql: string) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

const RE_TAO = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"[^;]*\bWHERE\b[^;]*;/gi;
const chiMucRieng = migrations.flatMap((m) =>
  [...boChuThich(m.sql).matchAll(RE_TAO)].map((x) => ({ ten: x[1], migration: m.ten })));

describe('chỉ mục riêng phần CONCURRENTLY — không để `prisma migrate dev` xoá', () => {
  it('có ít nhất các chỉ mục đã biết', () => {
    const ten = chiMucRieng.map((c) => c.ten);
    expect(ten).toEqual(expect.arrayContaining([
      'messages_zalo_msg_id_lien_ket_idx', 'messages_sender_uid_idx', 'messages_client_echo_id_idx',
    ]));
  });

  it('file migration có CONCURRENTLY chỉ gồm câu CREATE INDEX CONCURRENTLY (không giao dịch, không SET)', () => {
    for (const m of migrations.filter((x) => /CONCURRENTLY/i.test(boChuThich(x.sql)))) {
      if (!chiMucRieng.some((c) => c.migration === m.ten)) continue;
      const cau = boChuThich(m.sql).split(';').map((s) => s.trim()).filter(Boolean);
      for (const c of cau) expect(c, `${m.ten}: ${c.slice(0, 60)}`).toMatch(/^CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i);
    }
  });

  it('không migration nào về sau DROP các chỉ mục đó', () => {
    for (const c of chiMucRieng) {
      const sau = migrations.filter((m) => m.ten > c.migration);
      for (const m of sau) {
        const re = new RegExp(`DROP\\s+INDEX[^;]*"?${c.ten}"?`, 'i');
        expect(re.test(boChuThich(m.sql)), `${m.ten} xoá ${c.ten} (do migrate dev sinh?)`).toBe(false);
      }
    }
  });

  it('schema.prisma nêu tên từng chỉ mục trong chú thích (cảnh báo tại chỗ cho người chạy migrate dev)', () => {
    for (const c of chiMucRieng) expect(SCHEMA, c.ten).toContain(c.ten);
  });
});
