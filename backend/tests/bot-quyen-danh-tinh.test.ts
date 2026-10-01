// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot (docs/77 §8b-an-toàn) — danh tính CHẮC từ globalId Zalo đọc trực tiếp: phần THUẦN (bóc kết quả getUserInfo,
// làm sạch globalId, luật "nhiễm" — globalId mà hai uid trên CÙNG nick mang là globalId giữ chỗ).
import { describe, it, expect } from 'vitest';
import { bocThongTin, sachGlobalId, dungBanDanhTinh, chuanSdt, locLoHoSo, laNguonTinDuoc } from '../src/modules/bot-quyen/bot-quyen-danh-tinh.js';

const luc = new Date('2026-09-30T10:00:00Z');

describe('bot-quyen-danh-tinh (thuần)', () => {
  it('sachGlobalId: rỗng / "0" / null ⇒ null; bỏ khoảng trắng', () => {
    expect(sachGlobalId(' G1 ')).toBe('G1');
    for (const x of ['', ' ', '0', null, undefined, 'null']) expect(sachGlobalId(x)).toBeNull();
    expect(sachGlobalId(123)).toBe('123');
  });

  it('bocThongTin: KHÔNG đọc kết quả getGroupMembersInfo (profiles) — D1, chỉ changed_profiles của getUserInfo', () => {
    const m = bocThongTin({ profiles: { u1: { id: 'u1', globalId: 'G1', zaloName: 'A' } } }, ['u1', 'u2']);
    expect(m.size).toBe(0);
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

// Số LIVE đo trên staging 30/09 (giám sát D1): getGroupMembersInfo qua Vận Tải Minh Thức trả globalId CỦA CHÍNH VTMT cho
// mọi thành viên; getUserInfo trả đúng (Hưng → PODILQ…, Quốc → OGGI1EMN…).
const VT = 'nick-vt';
const VT_SELF = '619833576870383279';
const G_VT = '4LGTI0826CD3G07NBUGLTVSCHRN7QI80';
const HUNG_VT = '3835588809400259343';
const QUOC_VT = '5369941570764297136';
const TM_TU_VT = '2945555577789699285';
const CL_TU_VT = '1359961729460490730';
const G_HUNG = 'PODILQ0AIDDJ0211ASEAB2D36R8BD080';
const G_QUOC = 'OGGI1EMNLJHERLBGHBHK365CEMQOG580';
const hs = (globalId: string | null) => ({ globalId, ten: null });

describe('rào D1 — globalId của chính nick gọi (THUẦN)', () => {
  it('locLoHoSo: dạng LIVE (mọi thành viên mang globalId của nick gọi) ⇒ bỏ từng uid (gid_cua_nick_goi), không hỏi lại', () => {
    const lo = [TM_TU_VT, HUNG_VT, QUOC_VT, CL_TU_VT];
    const kq = locLoHoSo(lo, new Map(lo.map((u) => [u, hs(G_VT)])), { uidNick: VT_SELF, gidNick: G_VT });
    expect(kq.hoSo.size).toBe(0);
    expect(kq.thuLai).toEqual([]);
    expect([...kq.bo.values()]).toEqual(['gid_cua_nick_goi', 'gid_cua_nick_goi', 'gid_cua_nick_goi', 'gid_cua_nick_goi']);
  });

  it('locLoHoSo: lô trùng một globalId mà KHÔNG biết globalId nick (> 1 uid) ⇒ hỏi lại riêng (P3-1); lô 1 uid ⇒ giữ', () => {
    const hai = locLoHoSo(['a', 'b'], new Map([['a', hs('G')], ['b', hs('G')]]), { uidNick: VT_SELF, gidNick: null });
    expect([hai.thuLai, hai.hoSo.size]).toEqual([['a', 'b'], 0]);
    const mot = locLoHoSo(['a'], new Map([['a', hs('G')]]), { uidNick: VT_SELF, gidNick: null });
    expect([mot.thuLai, mot.hoSo.get('a')?.globalId]).toEqual([[], 'G']);
  });

  it('locLoHoSo: uid ≠ nick mang globalId của nick ⇒ bỏ RIÊNG uid đó; uid của chính nick giữ; người khác giữ', () => {
    const lo = [VT_SELF, HUNG_VT, QUOC_VT, TM_TU_VT, 'khong-tra'];
    const kq = locLoHoSo(lo, new Map([
      [VT_SELF, hs(G_VT)], [HUNG_VT, hs(G_HUNG)], [QUOC_VT, hs(G_QUOC)], [TM_TU_VT, hs(G_VT)],
    ]), { uidNick: VT_SELF, gidNick: null }); // globalId nick lấy từ lô (uid của chính nick có trong lô)
    expect(kq.thuLai).toEqual([]);
    expect([...kq.hoSo.keys()].sort()).toEqual([VT_SELF, HUNG_VT, QUOC_VT].sort());
    expect(Object.fromEntries(kq.bo)).toEqual({ [TM_TU_VT]: 'gid_cua_nick_goi' });
  });

  it('dungBanDanhTinh: dòng hỏng mang globalId của nick nhìn KHÔNG làm nhiễm globalId đó — VTMT vẫn nhận ra được', () => {
    const b = dungBanDanhTinh([
      { zaloAccountId: VT, zaloUid: VT_SELF, globalId: G_VT, layLuc: luc },
      ...[TM_TU_VT, HUNG_VT, QUOC_VT, CL_TU_VT].map((u) => ({ zaloAccountId: VT, zaloUid: u, globalId: G_VT, layLuc: luc })),
      { zaloAccountId: 'CL', zaloUid: '1333113565670020202', globalId: G_VT, layLuc: luc }, // VTMT nhìn từ Cẩm Loan
    ], new Map([[VT, VT_SELF], ['CL', '632106073555356463']]));
    expect(b.nhiem.has(G_VT)).toBe(false);
    expect(b.gid(VT, VT_SELF)).toBe(G_VT);
    expect(b.gid(VT, HUNG_VT)).toBeNull();
    expect(b.theoGid.get(G_VT)!.map((x) => `${x.nick}|${x.uid}`).sort()).toEqual([`CL|1333113565670020202`, `${VT}|${VT_SELF}`]);
    // không truyền tuNhin (bản cũ) ⇒ nhiễm — đúng lỗi staging
    expect(dungBanDanhTinh([
      { zaloAccountId: VT, zaloUid: VT_SELF, globalId: G_VT, layLuc: luc },
      { zaloAccountId: VT, zaloUid: HUNG_VT, globalId: G_VT, layLuc: luc },
    ]).nhiem.has(G_VT)).toBe(true);
  });

  it('nguồn tin được: zalo_user_info / zalo_find_user / zalo_nick_ket_noi; zalo_api (bản cũ) KHÔNG', () => {
    expect(['zalo_user_info', 'zalo_find_user', 'zalo_nick_ket_noi', 'zalo_api', null].map(laNguonTinDuoc))
      .toEqual([true, true, true, false, false]);
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
