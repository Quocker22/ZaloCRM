// SPDX-License-Identifier: AGPL-3.0-or-later
// Nhật ký máy in — phần THUẦN (không DB): từ khoá tìm không dấu, cắt token,
// đọc tham số API, dựng where, nhãn mã. Hợp đồng HOP-DONG-NHAT-KY-MAY-IN.md §1, §3.
import { describe, it, expect } from 'vitest';
import {
  taoTuKhoa,
  catTienToToken,
  catChu,
  cheToken,
  phanTichThamSo,
  taoWhereNhatKy,
  nhanCua,
  mucDoCua,
  laMaSuCo,
  MA_SU_CO,
  ThamSoSai,
} from '../../../src/modules/ai/may-in/nhat-ky.js';

describe('taoTuKhoa — tìm không dấu', () => {
  it('chữ thường, bỏ dấu, mọi ký tự không phải chữ/số thành ranh từ, bỏ phần rỗng', () => {
    expect(taoTuKhoa(['het_giay', 'Hết giấy khi in hoá đơn INV/2026/030045', null, 'Anh Lộc  Beco', undefined]))
      .toBe('het giay het giay khi in hoa don inv 2026 030045 anh loc beco');
  });
  it('số hoá đơn gõ kiểu nào cũng về một dãy từ (tên file dùng "_", Odoo dùng "/")', () => {
    expect(taoTuKhoa(['INV/2026/030045'])).toBe(taoTuKhoa(['INV_2026_030045']));
    expect(taoTuKhoa(['AI-INV_2026_030045-Anh_Loc_Beco'])).toBe('ai inv 2026 030045 anh loc beco');
  });
  it('từ tìm không bao giờ mang ký tự đại diện LIKE ("%", "_")', () => {
    expect(phanTichThamSo({ q: '%' }).q).toEqual([]);
    expect(phanTichThamSo({ q: '_ %a_b%' }).q).toEqual(['a', 'b']);
  });
});

describe('catTienToToken — KHÔNG lưu token', () => {
  it('cắt đúng tiền tố token', () => {
    expect(catTienToToken('tokBiMat123-1727170000000-4', 'tokBiMat123')).toBe('…-1727170000000-4');
  });
  it('không có token (hoặc không khớp) → chỉ giữ 2 đoạn cuối', () => {
    expect(catTienToToken('abc-def-1727170000000-4')).toBe('…-1727170000000-4');
    expect(catTienToToken('j1')).toBe('j1');
    expect(catTienToToken(null)).toBeNull();
  });
});

describe('cheToken — lưới cuối trước khi lưu', () => {
  const TOK = 'tokBiMatRatDai_8f3k';
  it('che trong chuỗi và trong object lồng', () => {
    expect(cheToken(`C:\\Temp\\AI-INV_1-Khach-${TOK}-1727-4.pdf lỗi`, TOK)).toBe('C:\\Temp\\AI-INV_1-Khach-…-1727-4.pdf lỗi');
    expect(cheToken({ a: { b: [`x${TOK}y`] } }, TOK)).toEqual({ a: { b: ['x…y'] } });
  });
  it('không token / token quá ngắn / giá trị rỗng → giữ nguyên', () => {
    expect(cheToken('abc', null)).toBe('abc');
    expect(cheToken('abc', 'ab')).toBe('abc');
    expect(cheToken(null, TOK)).toBeNull();
  });
});

describe('catChu', () => {
  it('cắt chuỗi dài, bỏ rỗng', () => {
    expect(catChu('  ')).toBeNull();
    expect(catChu(undefined)).toBeNull();
    expect(catChu('x'.repeat(20), 10)).toHaveLength(10);
  });
});

describe('phanTichThamSo', () => {
  const bayGio = new Date('2026-09-25T03:00:00.000Z');
  it('mặc định: 7 ngày gần nhất, 50 dòng, không lọc', () => {
    const t = phanTichThamSo({}, bayGio);
    expect(t.den.toISOString()).toBe(bayGio.toISOString());
    expect(t.den.getTime() - t.tu.getTime()).toBe(7 * 24 * 3600 * 1000);
    expect(t).toMatchObject({ q: [], mayInId: null, mucDo: null, loai: null, truoc: null, gioiHan: 50 });
  });
  it('q tách từ, bỏ dấu — mọi từ phải có (AND)', () => {
    expect(phanTichThamSo({ q: '  Lộc   HẾT giấy ' }, bayGio).q).toEqual(['loc', 'het', 'giay']);
  });
  it('gioiHan kẹp trong [1, 200]', () => {
    expect(phanTichThamSo({ gioiHan: '9999' }, bayGio).gioiHan).toBe(200);
    expect(phanTichThamSo({ gioiHan: '0' }, bayGio).gioiHan).toBe(1);
    expect(phanTichThamSo({ gioiHan: 'abc' }, bayGio).gioiHan).toBe(50);
  });
  it('con trỏ "ISO|id"', () => {
    const t = phanTichThamSo({ truoc: '2026-09-24T10:00:00.000Z|cabc' }, bayGio);
    expect(t.truoc).toEqual({ luc: new Date('2026-09-24T10:00:00.000Z'), id: 'cabc' });
  });
  it('tham số sai → ThamSoSai (route trả 400)', () => {
    expect(() => phanTichThamSo({ mucDo: 'nguy_hiem' }, bayGio)).toThrow(ThamSoSai);
    expect(() => phanTichThamSo({ tu: 'hom qua' }, bayGio)).toThrow(ThamSoSai);
    expect(() => phanTichThamSo({ truoc: 'xyz' }, bayGio)).toThrow(ThamSoSai);
    expect(() => phanTichThamSo({ tu: '2026-09-25', den: '2026-09-01' }, bayGio)).toThrow(ThamSoSai);
  });
});

describe('taoWhereNhatKy', () => {
  const bayGio = new Date('2026-09-25T03:00:00.000Z');
  it('luôn khoá theo org + khoảng thời gian; mỗi từ một điều kiện contains', () => {
    const w = taoWhereNhatKy('org1', phanTichThamSo({ q: 'loc het' }, bayGio)) as { AND: unknown[] };
    expect(w.AND).toContainEqual({ orgId: 'org1' });
    expect(w.AND).toContainEqual({ tuKhoa: { contains: 'loc' } });
    expect(w.AND).toContainEqual({ tuKhoa: { contains: 'het' } });
  });
  it('"loi_canh_bao" → mucDo in [loi, canh_bao]; con trỏ → OR ổn định', () => {
    const w = taoWhereNhatKy('org1', phanTichThamSo({ mucDo: 'loi_canh_bao', truoc: '2026-09-24T10:00:00.000Z|c9' }, bayGio)) as { AND: unknown[] };
    expect(w.AND).toContainEqual({ mucDo: { in: ['loi', 'canh_bao'] } });
    expect(w.AND).toContainEqual({
      OR: [
        { createdAt: { lt: new Date('2026-09-24T10:00:00.000Z') } },
        { createdAt: new Date('2026-09-24T10:00:00.000Z'), id: { lt: 'c9' } },
      ],
    });
  });
});

describe('mã sự cố', () => {
  it('đủ mã hợp đồng §1, nhãn tiếng Việt, mức đúng', () => {
    expect(Object.keys(MA_SU_CO).sort()).toEqual([
      'binh_thuong', 'can_xu_ly', 'het_giay', 'het_muc', 'ket_giay', 'khong_tim_thay_may_in',
      'khong_xac_nhan', 'loi_may_in', 'loi_pdf', 'loi_sumatra', 'mo_nap', 'offline',
    ]);
    expect(nhanCua('het_giay')).toBe('Hết giấy');
    expect(nhanCua('ket_giay')).toBe('Kẹt giấy');
    expect(mucDoCua('het_giay')).toBe('loi');
    expect(mucDoCua('het_muc')).toBe('canh_bao');
    expect(mucDoCua('da_in')).toBe('thong_tin');
    expect(nhanCua('ma_la_xyz')).toBe('ma_la_xyz');
    expect(laMaSuCo('het_giay')).toBe(true);
    expect(laMaSuCo('__proto__')).toBe(false);
    expect(laMaSuCo(42)).toBe(false);
  });
});
