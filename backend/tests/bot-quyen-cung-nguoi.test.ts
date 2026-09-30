// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot (docs/77 §8b) — nhận ra CÙNG một người qua nhiều nick (hàm thuần): union-find có rào "một uid mỗi nick",
// gộp ứng viên "Chờ gán" theo người.
import { describe, it, expect } from 'vitest';
import { gomNguoi, type LienKet } from '../src/modules/bot-quyen/bot-quyen-cung-nguoi.js';
import { gopTheoNguoi, gomTheoUid, locVaPhanTrang, type DongGom } from '../src/modules/bot-quyen/bot-quyen-nguoi-da-nhan.js';
import { AI_TU_DONG_UID } from '../src/modules/bot-quyen/bot-quyen-nhan-vien-uid.js';
import { AI_TU_DONG } from '../src/modules/bot-quyen/bot-quyen-danh-sach.js';

// Số thật đo trên staging 30/09 (nick Cẩm Loan = CL, nick Vận Tải Minh Thức = VT).
const HUNG_CL = '3395858500519725514';
const HUNG_VT = '3835588809400259343';
const QUOC_CL = '5809610033196845429';
const QUOC_VT = '5369941570764297136';
const tin = (a: string, nickA: string, b: string, nickB: string, so: number): LienKet => ({ a, nickA, b, nickB, so, nguon: 'cung_tin' });

describe('gomNguoi', () => {
  it('ghép đúng một-một theo tin chung (dữ liệu staging)', () => {
    const m = gomNguoi([tin(HUNG_CL, 'CL', HUNG_VT, 'VT', 236), tin(QUOC_CL, 'CL', QUOC_VT, 'VT', 39)]);
    expect(m.get(HUNG_CL)).toEqual([{ zaloUid: HUNG_CL, zaloAccountId: 'CL' }, { zaloUid: HUNG_VT, zaloAccountId: 'VT' }]);
    expect(m.get(HUNG_VT)).toEqual(m.get(HUNG_CL));
    expect(m.get(QUOC_VT)!.map((x) => x.zaloUid)).toEqual([QUOC_VT, QUOC_CL].sort());
    expect(m.has('khac')).toBe(false);
  });

  it('bắc cầu qua ba nick', () => {
    const m = gomNguoi([tin('a1', 'A', 'b1', 'B', 3), tin('b1', 'B', 'c1', 'C', 2)]);
    expect(m.get('c1')!.map((x) => x.zaloUid)).toEqual(['a1', 'b1', 'c1']);
  });

  it('rào: không gộp khi một nick sẽ có HAI uid (liên kết yếu hơn bị bỏ, không đoán)', () => {
    const m = gomNguoi([tin('a1', 'A', 'b1', 'B', 50), tin('a1', 'A', 'b2', 'B', 1)]);
    expect(m.get('a1')!.map((x) => x.zaloUid)).toEqual(['a1', 'b1']);
    expect(m.get('b2')).toEqual([{ zaloUid: 'b2', zaloAccountId: 'B' }]);
  });

  it('cùng uid xuất hiện ở hai nick (dữ liệu lệch) ⇒ bỏ liên kết đó', () => {
    const m = gomNguoi([tin('a1', 'A', 'b1', 'B', 5), tin('a1', 'C', 'c1', 'D', 5)]);
    expect(m.get('a1')!.map((x) => x.zaloUid)).toEqual(['a1', 'b1']);
    expect(m.has('c1')).toBe(false);
  });

  it('tin chung xét trước globalId; cùng nick / cùng uid bị bỏ', () => {
    const m = gomNguoi([
      { a: 'a1', nickA: 'A', b: 'b9', nickB: 'B', so: 1, nguon: 'global_id' },
      tin('a1', 'A', 'b1', 'B', 1),
      tin('x', 'A', 'y', 'A', 9),
      tin('z', 'A', 'z', 'B', 9),
    ]);
    expect(m.get('a1')!.map((x) => x.zaloUid)).toEqual(['a1', 'b1']);
    expect(m.has('x')).toBe(false);
  });

  it('AI_TU_DONG của bảng uid = của danh sách (nhật ký "tự động")', () => {
    expect(AI_TU_DONG_UID).toBe(AI_TU_DONG);
  });
});

describe('gopTheoNguoi (Chờ gán)', () => {
  const d = (uid: string, cid: string, nick: string, phut: number, ten: string): DongGom => ({
    uid, conversation_id: cid, loai: 'group', luc: new Date(Date.UTC(2026, 8, 30, 10, phut)), ten, ten_nhom: 'AI dev test',
    nick_id: nick, nick_ten: nick === 'CL' ? 'Cẩm Loan' : 'Vận Tải Minh Thức', nick_rieng_tu: false, nick_chu: null,
  });
  const dong = [d(HUNG_CL, 'g-cl', 'CL', 5, 'Trần Hưng'), d(HUNG_VT, 'g-vt', 'VT', 9, 'Trần Hưng'), d('khach', 'g-vt', 'VT', 1, 'Khách')];
  const nhom = gomNguoi([tin(HUNG_CL, 'CL', HUNG_VT, 'VT', 236)]);

  it('một dòng mỗi người, mang mọi uid; uid chính = uid ở nơi mới nhất', () => {
    const ds = gopTheoNguoi(gomTheoUid(dong), nhom);
    expect(ds).toHaveLength(2);
    const hung = ds.find((u) => u.uids.length === 2)!;
    expect(hung.zaloUid).toBe(HUNG_VT);
    expect(hung.uids.map((x) => [x.nick.ten, x.zaloUid])).toEqual([['Cẩm Loan', HUNG_CL], ['Vận Tải Minh Thức', HUNG_VT]]);
    expect(hung.noi.map((n) => n.zaloUid)).toEqual([HUNG_VT, HUNG_CL]);
  });

  it('đã gán dưới BẤT KỲ uid nào ⇒ cả dòng biến mất; tìm theo mọi uid', () => {
    const ds = gopTheoNguoi(gomTheoUid(dong), nhom);
    const khongLoai = locVaPhanTrang(ds, { loaiTru: new Set(), dangSaiBot: new Set() });
    expect(khongLoai.tong).toBe(2);
    const loai = locVaPhanTrang(ds, { loaiTru: new Set([HUNG_CL]), dangSaiBot: new Set() });
    expect(loai.ungVien.map((u) => u.zaloUid)).toEqual(['khach']);
    expect(locVaPhanTrang(ds, { loaiTru: new Set(), dangSaiBot: new Set(), tuKhoa: HUNG_CL.slice(0, 8) }).tong).toBe(1);
    expect(locVaPhanTrang(ds, { loaiTru: new Set(), dangSaiBot: new Set([HUNG_CL]) }).ungVien[0].dangSaiBot).toBe(true);
  });
});
