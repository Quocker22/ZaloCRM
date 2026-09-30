// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot (docs/77 §8b-an-toàn) — danh tính CHẮC từ globalId Zalo đọc trực tiếp: phần THUẦN (bóc kết quả getUserInfo,
// làm sạch globalId, luật "nhiễm" — globalId mà hai uid trên CÙNG nick mang là globalId giữ chỗ).
import { describe, it, expect } from 'vitest';
import { bocThongTin, sachGlobalId, dungBanDanhTinh, chuanSdt } from '../src/modules/bot-quyen/bot-quyen-danh-tinh.js';

const luc = new Date('2026-09-30T10:00:00Z');

describe('bot-quyen-danh-tinh (thuần)', () => {
  it('sachGlobalId: rỗng / "0" / null ⇒ null; bỏ khoảng trắng', () => {
    expect(sachGlobalId(' G1 ')).toBe('G1');
    for (const x of ['', ' ', '0', null, undefined, 'null']) expect(sachGlobalId(x)).toBeNull();
    expect(sachGlobalId(123)).toBe('123');
  });

  it('bocThongTin: khoá "<uid>_0" hoặc "<uid>", uid vắng ⇒ không có trong Map', () => {
    const m = bocThongTin({ changed_profiles: {
      '2945555577789699285_0': { globalId: 'G-TM', zaloName: 'Tiểu Mã', phoneNumber: '+84847565324' }, u2: { globalId: '' },
    } }, ['2945555577789699285', 'u2', 'u3']);
    expect(m.get('2945555577789699285')).toEqual({ globalId: 'G-TM', ten: 'Tiểu Mã', sdt: '84847565324' });
    expect(m.get('u2')).toEqual({ globalId: null, ten: null, sdt: null });
    expect(m.has('u3')).toBe(false);
    expect(bocThongTin(null, ['x']).size).toBe(0);
  });

  it('chuanSdt: 0xxx / +84xxx / 84xxx ⇒ 84xxx; sai ⇒ null', () => {
    expect(chuanSdt('0847 565 324')).toBe('84847565324');
    expect(chuanSdt('+84847565324')).toBe('84847565324');
    expect(chuanSdt('84847565324')).toBe('84847565324');
    expect(chuanSdt('12ab')).toBeNull();
    expect(chuanSdt(null)).toBeNull();
  });

  it('dungBanDanhTinh: globalId của hai uid trên CÙNG nick ⇒ nhiễm (bỏ); khác nick ⇒ cùng người', () => {
    const b = dungBanDanhTinh([
      { zaloAccountId: 'VT', zaloUid: '3835588809400259343', globalId: 'G-HUNG', layLuc: luc },
      { zaloAccountId: 'CL', zaloUid: '3395858500519725514', globalId: 'G-HUNG', layLuc: luc },
      { zaloAccountId: 'VT', zaloUid: 'nhom1', globalId: 'G-GIU-CHO', layLuc: luc },
      { zaloAccountId: 'VT', zaloUid: 'nhom2', globalId: 'G-GIU-CHO', layLuc: luc },
      { zaloAccountId: 'CL', zaloUid: 'nv', globalId: 'G-GIU-CHO', layLuc: luc },
      { zaloAccountId: 'CL', zaloUid: 'rong', globalId: null, layLuc: luc },
    ]);
    expect(b.nhiem).toEqual(new Set(['G-GIU-CHO']));
    expect(b.theoGid.get('G-HUNG')!.map((x) => x.uid).sort()).toEqual(['3395858500519725514', '3835588809400259343']);
    expect(b.theoGid.has('G-GIU-CHO')).toBe(false);
    expect(b.gid('CL', 'nv')).toBeNull();
    expect(b.gid('VT', '3835588809400259343')).toBe('G-HUNG');
    expect(b.gid(null, '3395858500519725514')).toBe('G-HUNG');
    expect(b.gid('CL', 'rong')).toBeNull();
    expect(b.layLuc('VT', '3835588809400259343')).toEqual(luc);
  });

  it('dungBanDanhTinh: cùng uid mà hai nick trả globalId khác nhau ⇒ không biết nick thì không tin (null)', () => {
    const b = dungBanDanhTinh([
      { zaloAccountId: 'A', zaloUid: 'u', globalId: 'G1', layLuc: luc },
      { zaloAccountId: 'B', zaloUid: 'u', globalId: 'G2', layLuc: luc },
    ]);
    expect(b.gid(null, 'u')).toBeNull();
    expect(b.gid('A', 'u')).toBe('G1');
  });
});

describe('vòng danh tính hẹn sau thay đổi NV', () => {
  it('kichHoatDanhTinh: trong vitest mặc định KHÔNG tự hẹn (tránh vòng lạc ghi nhật ký giữa test khác)', async () => {
    const svc = await import('../src/modules/bot-quyen/bot-quyen-service.js');
    const dt = await import('../src/modules/bot-quyen/bot-quyen-danh-tinh.js');
    let goi = 0;
    dt._datZaloDanhTinhChoTest({
      async thongTin() { goi++; return new Map(); },
      async timSdt() { return null; },
    });
    svc.kichHoatDanhTinh('org-khong-co');
    await svc._danhTinhChoTest();
    expect(goi).toBe(0); // tắt trong vitest
    dt._datZaloDanhTinhChoTest(null);
  });
});
