// SPDX-License-Identifier: AGPL-3.0-or-later
// Mức độ log app (hợp đồng hàng đợi/huỷ v5 §5 + §8.9): phân loại lúc lưu (phanLoaiMucDoApp),
// migration backfill bằng CÙNG luật (CASE sinh từ bảng luật — test khoá migration chứa đúng
// chuỗi sinh ra), lọc `mucDo` ở API, mã nhật ký nghiệp vụ mới (§8.8).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  phanLoaiMucDoApp,
  sqlPhanLoaiMucDoApp,
  tuDauTien,
  LUAT_MUC_DO_APP,
  phanTichThamSoApp,
  taoWhereNhatKyApp,
  laLoiChuaMigrate,
} from '../../../src/modules/ai/may-in/nhat-ky-app.js';
import { MA_SU_KIEN, mucDoCua, nhanCua, ThamSoSai } from '../../../src/modules/ai/may-in/nhat-ky.js';
import { MAU_MUC_DO_APP } from './mau-muc-do-app.js';

const MIGRATION = new URL('../../../prisma/migrations/20260925200000_print_app_logs_muc_do/migration.sql', import.meta.url);

describe('phanLoaiMucDoApp — bảng mẫu (cũng là bảng đối chiếu TS↔SQL)', () => {
  for (const m of MAU_MUC_DO_APP) {
    it(`${m.suKien} "${m.noiDung.slice(0, 40)}" → ${m.mucDo} (${m.vi})`, () => {
      expect(phanLoaiMucDoApp(m.suKien, m.noiDung)).toBe(m.mucDo);
    });
  }

  it('mọi luật của bảng luật đều có ít nhất một dòng mẫu dương', () => {
    for (const l of LUAT_MUC_DO_APP) {
      const co = MAU_MUC_DO_APP.some((m) => m.mucDo === l.mucDo
        && ((l.suKien ?? []).includes(m.suKien) || (l.tienTo !== undefined && m.suKien.startsWith(l.tienTo))));
      expect(co, JSON.stringify(l)).toBe(true);
    }
  });

  it('từ đầu tiên: bỏ khoảng trắng đầu dòng, cắt ở dấu cách / tab / xuống dòng', () => {
    expect(tuDauTien('het_giay chi tiết')).toBe('het_giay');
    expect(tuDauTien(' \t het_muc\nx')).toBe('het_muc');
    expect(tuDauTien('')).toBe('');
    expect(tuDauTien('   ')).toBe('');
  });

  it('suKien/noiDung rỗng không ném', () => {
    expect(phanLoaiMucDoApp('', '')).toBe('thong_tin');
    expect(phanLoaiMucDoApp('trang_thai_may_in', '')).toBe('loi'); // không có mã = khác binh_thuong/het_muc
  });
});

describe('migration backfill — CÙNG luật với TS', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('chứa NGUYÊN VĂN câu CASE sinh từ bảng luật (sửa luật mà quên migration → đỏ)', () => {
    expect(sql).toContain(sqlPhanLoaiMucDoApp());
  });

  it('thêm cột NOT NULL DEFAULT thong_tin + index (org_id, muc_do, luc DESC), đều IF NOT EXISTS', () => {
    expect(sql).toContain(`ALTER TABLE "print_app_logs" ADD COLUMN IF NOT EXISTS "muc_do" TEXT NOT NULL DEFAULT 'thong_tin';`);
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "print_app_logs_org_id_muc_do_luc_idx" ON "print_app_logs"("org_id", "muc_do", "luc" DESC);');
    expect(sql).toMatch(/UPDATE "print_app_logs" SET "muc_do" = /);
  });

  it('SQL so chữ trên dạng NFC ở cả cột lẫn hằng', () => {
    const c = sqlPhanLoaiMucDoApp();
    expect(c).toContain('normalize("su_kien", NFC)');
    expect(c).toContain('normalize("noi_dung", NFC)');
    expect(c).toContain(`normalize('${'TRỐNG'.normalize('NFC')}', NFC)`);
    expect(c).not.toContain('TRỐNG'.normalize('NFD'));
    expect(c).toMatch(/ELSE 'thong_tin'\s+END$/);
  });
});

describe('API /nhat-ky-app — lọc mucDo', () => {
  const bayGio = new Date('2026-09-25T10:00:00Z');
  it('mucDo hợp lệ → where; "loi_canh_bao" → in [loi, canh_bao]; giá trị lạ → ThamSoSai', () => {
    const t = phanTichThamSoApp({ mucDo: 'loi_canh_bao' }, bayGio);
    expect(t.mucDo).toBe('loi_canh_bao');
    expect((taoWhereNhatKyApp('o1', t) as { AND: unknown[] }).AND).toContainEqual({ mucDo: { in: ['loi', 'canh_bao'] } });
    for (const m of ['loi', 'canh_bao', 'thong_tin']) {
      expect((taoWhereNhatKyApp('o1', phanTichThamSoApp({ mucDo: m }, bayGio)) as { AND: unknown[] }).AND).toContainEqual({ mucDo: m });
    }
    expect(phanTichThamSoApp({}, bayGio).mucDo).toBeNull();
    expect(JSON.stringify(taoWhereNhatKyApp('o1', phanTichThamSoApp({}, bayGio)))).not.toContain('mucDo');
    expect(() => phanTichThamSoApp({ mucDo: 'nghiem_trong' }, bayGio)).toThrow(ThamSoSai);
  });

  it('cột muc_do chưa có (P2022) cũng là "chưa migrate"', () => {
    expect(laLoiChuaMigrate({ code: 'P2022' })).toBe(true);
    expect(laLoiChuaMigrate({ code: 'P2021' })).toBe(true);
    expect(laLoiChuaMigrate({ code: 'P2002' })).toBe(false);
  });
});

describe('print_logs — mã mới của hàng đợi/huỷ (§8.8)', () => {
  it('da_huy (thông tin), huy_that_bai (cảnh báo), bo_theo_doi (cảnh báo) có nhãn tiếng Việt', () => {
    expect(MA_SU_KIEN.da_huy).toEqual({ nhan: 'Đã huỷ lệnh in', mucDo: 'thong_tin' });
    expect(MA_SU_KIEN.huy_that_bai).toEqual({ nhan: 'Không huỷ được lệnh in', mucDo: 'canh_bao' });
    expect(MA_SU_KIEN.bo_theo_doi).toEqual({ nhan: 'Bỏ theo dõi lệnh in', mucDo: 'canh_bao' });
    expect(mucDoCua('huy_that_bai')).toBe('canh_bao');
    expect(nhanCua('bo_theo_doi')).toBe('Bỏ theo dõi lệnh in');
  });
});
