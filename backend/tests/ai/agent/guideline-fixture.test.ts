// SPDX-License-Identifier: AGPL-3.0-or-later
// Kiểm CẤU TRÚC bộ fixture matcher (offline, 0 LLM — nằm trong `npm test`).
//
// Fixture tham chiếu guideline bằng slug `ten` — gõ nhầm slug thì eval LLM thật
// sẽ trượt oan mà không ai hiểu vì sao. Bắt lỗi đó ở đây, rẻ và tức thì.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SEED_GUIDELINE_KHACH } from '../../../prisma/seeds/guideline-khach-data.js';
import { CAC_STAGE } from '../../../src/modules/ai/agent/guideline-matcher.js';

const duongDan = fileURLToPath(
  new URL('../../../eval-scenarios/guideline-matcher.json', import.meta.url),
);

interface CaFixture {
  id: string;
  name: string;
  hoiThoai: Array<{ vai: 'khach' | 'shop'; noiDung: string }>;
  tinMoi: string;
  stageDung: string[];
  phaiMatch: string[];
  khongDuocMatch: string[];
}

const cas: CaFixture[] = JSON.parse(readFileSync(duongDan, 'utf8'));
const tenSeed = new Set(SEED_GUIDELINE_KHACH.map((g) => g.ten));
const tenThuong = new Set(
  SEED_GUIDELINE_KHACH.filter((g) => g.mucDo === 'thuong').map((g) => g.ten),
);

describe('fixture guideline-matcher.json', () => {
  it('id không trùng, tin mới không rỗng', () => {
    const ids = cas.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of cas) expect(c.tinMoi.trim().length, c.id).toBeGreaterThan(0);
  });

  it('mọi slug trong phaiMatch/khongDuocMatch tồn tại trong seed và là mucDo=thuong', () => {
    for (const c of cas) {
      for (const ten of [...c.phaiMatch, ...c.khongDuocMatch]) {
        expect(tenSeed.has(ten), `${c.id}: slug '${ten}' không có trong seed`).toBe(true);
        // bat_buoc không qua matcher — fixture nhắc tới nó là fixture sai.
        expect(tenThuong.has(ten), `${c.id}: slug '${ten}' là bat_buoc, matcher không xét`).toBe(true);
      }
    }
  });

  it('stageDung chỉ chứa 4 stage hợp lệ', () => {
    for (const c of cas) {
      expect(c.stageDung.length, c.id).toBeGreaterThan(0);
      for (const s of c.stageDung) {
        expect(CAC_STAGE, `${c.id}: stage '${s}'`).toContain(s);
      }
    }
  });

  it('phaiMatch và khongDuocMatch không giẫm nhau', () => {
    for (const c of cas) {
      const cam = new Set(c.khongDuocMatch);
      for (const ten of c.phaiMatch) {
        expect(cam.has(ten), `${c.id}: '${ten}' vừa phải match vừa cấm match`).toBe(false);
      }
    }
  });

  it('seed không có slug trùng và biến thể chốt đơn đủ cả hai nhánh yeuCau', () => {
    expect(tenSeed.size).toBe(SEED_GUIDELINE_KHACH.length);
    const yeuCau = SEED_GUIDELINE_KHACH.map((g) => g.yeuCau);
    expect(yeuCau).toContain('tu_chot_don');
    expect(yeuCau).toContain('khong_tu_chot_don');
  });
});
