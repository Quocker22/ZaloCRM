// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot — mã Zalo đọc ĐÚNG như zca-js 2.1.2 (docs/77 zca-js-id.md). Cổng giả có HÌNH của zca-js (tests/helpers/zca-gia.ts,
// dẫn dòng mã nguồn): uid theo nick, "_0" là phiên bản hồ sơ, `userId` của hồ sơ = uid hỏi, getGroupMembersInfo không phải
// nguồn globalId, GroupMessage.threadId là MÃ NHÓM.
import { describe, it, expect } from 'vitest';
import { taoZcaGia } from './helpers/zca-gia.js';
import {
  bocThongTin, taoApiTuZca, locLoHoSo, locSauThuLai,
} from '../src/modules/bot-quyen/bot-quyen-danh-tinh.js';
import { uidHoiHoSoTinDen } from '../src/modules/zalo/uid-ho-so.js';
import { bocHoSoThanhVien } from '../src/modules/bot-quyen/bot-quyen-thanh-vien.js';

const VT = 'nick-vt';
const VT_SELF = '619833576870383279';
const HUNG_VT = '3835588809400259343';
const QUOC_VT = '5369941570764297136';
const HUNG_CL = '3395858500519725514';
const G_VT = '4LGTI0826CD3G07NBUGLTVSCHRN7QI80';
const G_HUNG = 'PODILQ0AIDDJ0211ASEAB2D36R8BD080';
const G_QUOC = 'OGGI1EMNLJHERLBGHBHK365CEMQOG580';
const BANG = {
  [VT]: {
    [VT_SELF]: { globalId: G_VT, zaloName: 'Vận Tải Minh Thức', phoneNumber: '+84876628854' },
    [HUNG_VT]: { globalId: G_HUNG, zaloName: 'Trần Hưng' },
    [QUOC_VT]: { globalId: G_QUOC, zaloName: 'Viết Quốc' },
  },
};

describe('getUserInfo theo zca-js (getUserInfo.ts:25-56)', () => {
  it('CRM truyền uid TRƠN; zca-js tự thêm "_0" (phiên bản hồ sơ) — khoá trả về "uid" hay "uid_0" đều đọc được', async () => {
    for (const khoa of ['uid', 'uid_0'] as const) {
      const z = taoZcaGia(BANG, { khoa });
      const api = taoApiTuZca(() => z.nick(VT));
      const m = await api.thongTin(VT, [HUNG_VT, QUOC_VT, HUNG_CL]);
      expect(z.goi).toEqual([{ nick: VT, ham: 'getUserInfo', gui: [`${HUNG_VT}_0`, `${QUOC_VT}_0`, `${HUNG_CL}_0`] }]);
      expect(m.get(HUNG_VT)?.globalId).toBe(G_HUNG);
      expect(m.get(QUOC_VT)?.globalId).toBe(G_QUOC);
      // uid góc Cẩm Loan hỏi qua VTMT ⇒ Zalo không trả (uid theo nick)
      expect(m.has(HUNG_CL)).toBe(false);
    }
  });

  it('userId của hồ sơ ≠ uid hỏi ⇒ KHÔNG nhận globalId (loi uid_lech) — chặn đúng dạng "trả hồ sơ người khác dưới khoá uid"', async () => {
    const z = taoZcaGia(BANG, { ghiDe: { [VT]: { [HUNG_VT]: { userId: VT_SELF, globalId: G_VT } } } });
    const m = await taoApiTuZca(() => z.nick(VT)).thongTin(VT, [HUNG_VT, QUOC_VT]);
    expect(m.get(HUNG_VT)).toEqual({ globalId: null, ten: null, sdt: null, loi: 'uid_lech' });
    expect(m.get(QUOC_VT)?.globalId).toBe(G_QUOC);
  });

  it('userId có đuôi phiên bản ("uid_0") vẫn là cùng uid', () => {
    const m = bocThongTin({ changed_profiles: { [HUNG_VT]: { userId: `${HUNG_VT}_0`, globalId: G_HUNG } } }, [HUNG_VT]);
    expect(m.get(HUNG_VT)?.globalId).toBe(G_HUNG);
  });

  it('uid nằm trong unchanged_profiles ⇒ không có globalId (loi khong_doi), không phải "không tồn tại"', async () => {
    const z = taoZcaGia(BANG, { khongDoi: new Set([QUOC_VT]) });
    const m = await taoApiTuZca(() => z.nick(VT)).thongTin(VT, [QUOC_VT]);
    expect(m.get(QUOC_VT)).toEqual({ globalId: null, ten: null, sdt: null, loi: 'khong_doi' });
  });

  it('kết quả getGroupMembersInfo (`profiles`) KHÔNG BAO GIỜ được đọc làm globalId (D1: Zalo trả globalId của nick gọi)', async () => {
    const z = taoZcaGia(BANG, { gmiTraGidNickGoi: { [VT]: G_VT } });
    const gmi = await z.nick(VT).getGroupMembersInfo([HUNG_VT, QUOC_VT]);
    expect(z.goi[0].gui).toEqual([`${HUNG_VT}_0`, `${QUOC_VT}_0`]);
    expect((gmi as { profiles: Record<string, { globalId: string }> }).profiles[HUNG_VT].globalId).toBe(G_VT);
    expect(bocThongTin(gmi, [HUNG_VT, QUOC_VT]).size).toBe(0);
  });
});

describe('findUser theo zca-js (findUser.ts:19-50)', () => {
  it('uid trả về THEO NICK GỌI + globalId; lỗi 216 bị nuốt ⇒ null', async () => {
    const z = taoZcaGia(BANG, { sdt: { '84847565324': { [VT]: { uid: '2945555577789699285', globalId: 'G-TM', ten: 'Tiểu Mã Nelia' } } } });
    const api = taoApiTuZca(() => z.nick(VT));
    expect(await api.timSdt(VT, '84847565324')).toEqual({ uid: '2945555577789699285', globalId: 'G-TM', ten: 'Tiểu Mã Nelia' });
    expect(await api.timSdt(VT, '84900000000')).toBeNull();
  });
});

describe('rào lô — P3-1: chỉ uid DÙNG CHUNG globalId bị hỏi lại riêng, không bỏ cả lô', () => {
  const hs = (globalId: string | null) => ({ globalId, ten: null });

  it('locLoHoSo: hai uid cùng globalId lạ ⇒ thử lại RIÊNG hai uid đó; uid khác trong lô giữ nguyên', () => {
    const kq = locLoHoSo(['a', 'b', HUNG_VT, 'x'], new Map([['a', hs('G-GC')], ['b', hs('G-GC')], [HUNG_VT, hs(G_HUNG)]]),
      { uidNick: VT_SELF, gidNick: G_VT });
    expect(kq.thuLai.sort()).toEqual(['a', 'b']);
    expect([...kq.hoSo.keys()]).toEqual([HUNG_VT]);
    expect(kq.bo.size).toBe(0);
  });

  it('locLoHoSo: globalId của nick gọi trên uid khác ⇒ bỏ ngay (không tốn lời gọi thử lại)', () => {
    const lo = ['t', HUNG_VT, QUOC_VT];
    const kq = locLoHoSo(lo, new Map(lo.map((u) => [u, hs(G_VT)])), { uidNick: VT_SELF, gidNick: G_VT });
    expect(kq.thuLai).toEqual([]);
    expect([...kq.bo.values()]).toEqual(['gid_cua_nick_goi', 'gid_cua_nick_goi', 'gid_cua_nick_goi']);
  });

  it('locSauThuLai: hỏi riêng ra globalId khác nhau ⇒ nhận; vẫn trùng nhau / trùng uid đã nhận ⇒ bỏ (lo_trung_gid)', () => {
    const daNhan = new Map([[HUNG_VT, hs(G_HUNG)]]);
    const r1 = locSauThuLai(['a', 'b'], new Map([['a', hs('G-A')], ['b', hs('G-B')]]), daNhan, { uidNick: VT_SELF, gidNick: G_VT });
    expect([...r1.hoSo.entries()].map(([u, h]) => [u, h.globalId])).toEqual([['a', 'G-A'], ['b', 'G-B']]);
    const r2 = locSauThuLai(['a', 'b', 'c'], new Map([['a', hs('G-GC')], ['b', hs('G-GC')], ['c', hs(G_HUNG)]]), daNhan,
      { uidNick: VT_SELF, gidNick: G_VT });
    expect(r2.hoSo.size).toBe(0);
    expect(Object.fromEntries(r2.bo)).toEqual({ a: 'lo_trung_gid', b: 'lo_trung_gid', c: 'lo_trung_gid' });
  });
});

describe('listener — uid nào được hỏi hồ sơ (models/Message.ts:90-120)', () => {
  // UserMessage: threadId = uidFrom == "0" ? idTo : uidFrom; isSelf = uidFrom == "0"; uidFrom "0" ⇒ uid của nick.
  // GroupMessage: threadId = idTo (MÃ NHÓM); isSelf = uidFrom == "0"; uidFrom "0" ⇒ uid của nick.
  it('1-1: tin đến ⇒ uidFrom; tin mình gửi ⇒ threadId (người nhận)', () => {
    expect(uidHoiHoSoTinDen({ type: 0, isSelf: false, threadId: HUNG_VT, data: { uidFrom: HUNG_VT, idTo: VT_SELF } })).toBe(HUNG_VT);
    expect(uidHoiHoSoTinDen({ type: 0, isSelf: true, threadId: HUNG_VT, data: { uidFrom: VT_SELF, idTo: HUNG_VT } })).toBe(HUNG_VT);
  });
  it('NHÓM: tin người khác ⇒ uidFrom; tin CHÍNH nick gửi ⇒ KHÔNG hỏi (threadId là MÃ NHÓM — getUserInfo(mã nhóm) trả globalId giữ chỗ)', () => {
    expect(uidHoiHoSoTinDen({ type: 1, isSelf: false, threadId: '166544585134854522', data: { uidFrom: HUNG_VT, idTo: '166544585134854522' } })).toBe(HUNG_VT);
    expect(uidHoiHoSoTinDen({ type: 1, isSelf: true, threadId: '166544585134854522', data: { uidFrom: VT_SELF, idTo: '166544585134854522' } })).toBeNull();
    expect(uidHoiHoSoTinDen({ type: 1, isSelf: false, threadId: 'g', data: { uidFrom: '' } })).toBeNull();
  });
});

describe('ngăn Thành viên — hồ sơ getGroupMembersInfo khoá theo `id` (getGroupMembersInfo.ts:4-20)', () => {
  it('khoá "uid" hoặc "uid_0" ⇒ tên theo uid TRƠN (ưu tiên trường id)', () => {
    const m = bocHoSoThanhVien({ profiles: { [`${HUNG_VT}_0`]: { id: HUNG_VT, displayName: 'Hưng' }, [QUOC_VT]: { zaloName: 'Quốc' } } });
    expect(m.get(HUNG_VT)).toBe('Hưng');
    expect(m.get(QUOC_VT)).toBe('Quốc');
    expect(bocHoSoThanhVien(null).size).toBe(0);
  });
});
