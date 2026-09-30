// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot — MẶC ĐỊNH chức năng nhóm (docs/77 §8, chủ 30/09): nhóm toàn nhân viên ⇒ `sales` ("Nhóm nhân viên"),
// có người không phải nhân viên ⇒ `khach`, danh sách thành viên chưa biết đủ ⇒ KHÔNG có mặc định (bot im, D-DS).
// Chủ xếp tường minh luôn thắng mặc định. Luật THUẦN — không cần DB.
import { describe, it, expect } from 'vitest';
import {
  tinhMacDinhNhom, chucNangHieuLuc, type DanhSachDaDoc,
} from '../src/modules/bot-quyen/bot-quyen-mac-dinh.js';
import { phanTichNhom } from '../src/modules/bot-quyen/bot-quyen-danh-sach.js';

const NICK = 'uid-nick-hn';
const NICK_KHAC = 'uid-nick-hcm';
const nv = (x: Record<string, string>) => new Map(Object.entries(x));
const ds = (uids: string[], them: Partial<DanhSachDaDoc> = {}): DanhSachDaDoc => ({
  uids, dayDu: true, canDocLai: false, docLuc: new Date('2026-09-30T08:00:00Z'), ...them,
});
const boiCanh = (trangThai: Record<string, string>) => ({
  nickUid: NICK, trangThaiNv: nv(trangThai), nickCrm: new Set([NICK, NICK_KHAC]),
});

describe('tinhMacDinhNhom — bảng mặc định', () => {
  it('toàn nhân viên (kể cả vai cong_ty) + nick của chính nhóm ⇒ sales, lý do toan_nhan_vien', () => {
    const kq = tinhMacDinhNhom(ds([NICK, 'a', 'b']), boiCanh({ a: 'hoat_dong', b: 'hoat_dong' }));
    expect(kq).toMatchObject({ chucNang: 'sales', lyDo: 'toan_nhan_vien', soThanhVien: 3, soNguoiNgoai: 0 });
  });

  it('NV đang khoá vẫn là nhân viên (bot không coi là người ngoài) ⇒ sales', () => {
    expect(tinhMacDinhNhom(ds([NICK, 'a']), boiCanh({ a: 'khoa' })).chucNang).toBe('sales');
  });

  it('một người ngoài ⇒ khach, đếm đúng', () => {
    const kq = tinhMacDinhNhom(ds([NICK, 'a', 'x']), boiCanh({ a: 'hoat_dong' }));
    expect(kq).toMatchObject({ chucNang: 'khach', lyDo: 'co_nguoi_ngoai', soNguoiNgoai: 1, soNickKhac: 0, soNguoiNghi: 0 });
    expect(kq.nguoiNgoai).toEqual(['x']);
  });

  it('nick CRM KHÁC của org chưa có trong danh sách NV ⇒ khach (bot coi là người ngoài)', () => {
    const kq = tinhMacDinhNhom(ds([NICK, 'a', NICK_KHAC]), boiCanh({ a: 'hoat_dong' }));
    expect(kq).toMatchObject({ chucNang: 'khach', soNguoiNgoai: 1, soNickKhac: 1 });
  });

  it('nick CRM khác ĐÃ được xếp là NV (vd người công ty) ⇒ không còn là người ngoài', () => {
    expect(tinhMacDinhNhom(ds([NICK, 'a', NICK_KHAC]), boiCanh({ a: 'hoat_dong', [NICK_KHAC]: 'hoat_dong' })).chucNang)
      .toBe('sales');
  });

  it('người ĐÃ NGHỈ trong nhóm ⇒ khach (không phải nhân viên nữa), đếm riêng', () => {
    const kq = tinhMacDinhNhom(ds([NICK, 'a', 'b']), boiCanh({ a: 'hoat_dong', b: 'nghi' }));
    expect(kq).toMatchObject({ chucNang: 'khach', soNguoiNgoai: 1, soNguoiNghi: 1 });
  });

  it('chưa từng đọc danh sách ⇒ không có mặc định (chua_doc)', () => {
    expect(tinhMacDinhNhom(null, boiCanh({}))).toMatchObject({ chucNang: null, lyDo: 'chua_doc' });
  });

  it('danh sách THIẾU (Zalo không trả đủ) ⇒ không có mặc định, kể cả khi phần đọc được toàn NV', () => {
    expect(tinhMacDinhNhom(ds([NICK, 'a'], { dayDu: false }), boiCanh({ a: 'hoat_dong' })))
      .toMatchObject({ chucNang: null, lyDo: 'thieu_danh_sach' });
  });

  it('danh sách rỗng ⇒ coi là thiếu', () => {
    expect(tinhMacDinhNhom(ds([]), boiCanh({})).chucNang).toBeNull();
  });

  it('đang chờ đọc lại (thành viên vừa đổi / nick vừa kết nối lại) ⇒ không có mặc định (dang_doc_lai)', () => {
    expect(tinhMacDinhNhom(ds([NICK, 'a'], { canDocLai: true }), boiCanh({ a: 'hoat_dong' })))
      .toMatchObject({ chucNang: null, lyDo: 'dang_doc_lai' });
  });

  it('NV bị đưa khỏi danh sách (xoá khỏi map) ⇒ tính lại thành khach', () => {
    const truoc = tinhMacDinhNhom(ds([NICK, 'a', 'b']), boiCanh({ a: 'hoat_dong', b: 'hoat_dong' }));
    const sau = tinhMacDinhNhom(ds([NICK, 'a', 'b']), boiCanh({ a: 'hoat_dong' }));
    expect(truoc.chucNang).toBe('sales');
    expect(sau.chucNang).toBe('khach');
  });

  it('nick của nhóm chưa biết uid (null) ⇒ uid lạ trong nhóm vẫn là người ngoài', () => {
    const kq = tinhMacDinhNhom(ds([NICK, 'a']), { ...boiCanh({ a: 'hoat_dong' }), nickUid: null, nickCrm: new Set() });
    expect(kq.chucNang).toBe('khach');
  });

  it('nguoiNgoai giữ tối đa 20 uid (đủ để trang gợi ý), đếm vẫn đủ', () => {
    const uids = [NICK, ...Array.from({ length: 30 }, (_, i) => `x${i}`)];
    const kq = tinhMacDinhNhom(ds(uids), boiCanh({}));
    expect(kq.soNguoiNgoai).toBe(30);
    expect(kq.nguoiNgoai).toHaveLength(20);
  });
});

describe('chucNangHieuLuc — chủ xếp tường minh luôn thắng', () => {
  const macDinhSales = tinhMacDinhNhom(ds([NICK, 'a']), boiCanh({ a: 'hoat_dong' }));
  const macDinhKhach = tinhMacDinhNhom(ds([NICK, 'x']), boiCanh({}));
  const chuaBiet = tinhMacDinhNhom(null, boiCanh({}));

  it('có xếp tường minh ⇒ dùng nó, mac_dinh=false (kể cả khi mặc định là khach)', () => {
    expect(chucNangHieuLuc('admin', macDinhKhach)).toEqual({ chucNang: 'admin', macDinh: false });
    expect(chucNangHieuLuc('khach', macDinhSales)).toEqual({ chucNang: 'khach', macDinh: false });
    expect(chucNangHieuLuc('sales', chuaBiet)).toEqual({ chucNang: 'sales', macDinh: false });
  });

  it('không xếp ⇒ mặc định, mac_dinh=true', () => {
    expect(chucNangHieuLuc(null, macDinhSales)).toEqual({ chucNang: 'sales', macDinh: true });
    expect(chucNangHieuLuc(null, macDinhKhach)).toEqual({ chucNang: 'khach', macDinh: true });
  });

  it('không xếp + không có mặc định ⇒ null (chưa xếp loại — bot im)', () => {
    expect(chucNangHieuLuc(null, chuaBiet)).toEqual({ chucNang: null, macDinh: true });
  });
});

describe('phanTichNhom — đọc kết quả getGroupInfo (theo lô)', () => {
  it('gộp memVerList / memberIds / currentMems, bỏ trùng; đủ khi hasMoreMember=0 và đủ totalMember', () => {
    const info = { gridInfoMap: { g1: { memVerList: ['1_0', '2_3'], memberIds: ['2'], currentMems: [{ id: '3' }], totalMember: 3, hasMoreMember: 0 } } };
    expect(phanTichNhom(info, 'g1')).toEqual({ uids: ['1', '2', '3'], dayDu: true });
  });
  it('thiếu (hasMoreMember > 0 hoặc ít hơn totalMember) ⇒ dayDu=false', () => {
    expect(phanTichNhom({ gridInfoMap: { g: { memVerList: ['1_0'], totalMember: 1, hasMoreMember: 4 } } }, 'g')?.dayDu).toBe(false);
    expect(phanTichNhom({ gridInfoMap: { g: { memVerList: ['1_0'], totalMember: 2 } } }, 'g')?.dayDu).toBe(false);
  });
  it('KHÔNG lấy nhóm khác trong lô khi thiếu khoá (khác bot-quyen-thanh-vien một nhóm)', () => {
    expect(phanTichNhom({ gridInfoMap: { khac: { memVerList: ['1_0'] } } }, 'g')).toBeNull();
    expect(phanTichNhom(null, 'g')).toBeNull();
  });
  it('rỗng ⇒ dayDu=false', () => {
    expect(phanTichNhom({ gridInfoMap: { g: { memVerList: [] } } }, 'g')).toEqual({ uids: [], dayDu: false });
  });
});
