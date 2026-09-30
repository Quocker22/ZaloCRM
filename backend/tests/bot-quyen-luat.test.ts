// SPDX-License-Identifier: AGPL-3.0-or-later
// Quyền bot (docs/77 §2–§3) — luật THUẦN: giá trị enum, "hạ/khoá" (bắt buộc lý do),
// admin hoạt động, và phiên bản cấu hình công khai (băm nội dung ổn định).
// Không cần DB — chạy trong `npm test`.
import { describe, it, expect } from 'vitest';
import {
  CHUC_NANG_NHOM, VAI_NV, TRANG_THAI_NV,
  laChucNang, laVai, laTrangThai,
  laHaChucNang, laHaVai, laHaTrangThai, laAdminHoatDong, laKhoaKhiTao,
} from '../src/modules/bot-quyen/bot-quyen-luat.js';
import { jsonChuan, ghepCauHinhCongKhai } from '../src/modules/bot-quyen/bot-quyen-cong-khai.js';

describe('giá trị enum (docs/77 §2)', () => {
  it('đúng ba bộ giá trị của thiết kế', () => {
    expect([...CHUC_NANG_NHOM]).toEqual(['admin', 'sales', 'kho', 'ke_toan', 'khach']);
    expect([...VAI_NV]).toEqual(['admin', 'sales', 'kho', 'ke_toan', 'cong_ty']);
    expect([...TRANG_THAI_NV]).toEqual(['hoat_dong', 'khoa', 'nghi']);
  });

  it('nhận giá trị hợp lệ, từ chối giá trị lạ / sai kiểu / sai hoa thường', () => {
    expect(laChucNang('khach')).toBe(true);
    expect(laChucNang('cong_ty')).toBe(false); // vai, không phải chức năng nhóm
    expect(laChucNang('Admin')).toBe(false);
    expect(laChucNang(null)).toBe(false);
    expect(laVai('cong_ty')).toBe(true);
    expect(laVai('khach')).toBe(false); // chức năng nhóm, không phải vai
    expect(laVai(1)).toBe(false);
    expect(laTrangThai('nghi')).toBe(true);
    expect(laTrangThai('active')).toBe(false);
  });
});

describe('hạ chức năng nhóm = mất ít nhất một năng lực', () => {
  it('admin → sales / kho / ke_toan là hạ', () => {
    expect(laHaChucNang('admin', 'sales')).toBe(true);
    expect(laHaChucNang('admin', 'kho')).toBe(true);
    expect(laHaChucNang('admin', 'ke_toan')).toBe(true);
  });
  it('bất kỳ → khach hoặc → chưa xếp loại (bot im) là hạ', () => {
    expect(laHaChucNang('sales', 'khach')).toBe(true);
    expect(laHaChucNang('sales', null)).toBe(true);
    expect(laHaChucNang('khach', null)).toBe(false); // vốn đã im, không mất gì
  });
  it('kho ↔ ke_toan mất một năng lực ⇒ hạ', () => {
    expect(laHaChucNang('kho', 'ke_toan')).toBe(true);
    expect(laHaChucNang('ke_toan', 'kho')).toBe(true);
  });
  it('nâng / xếp loại lần đầu / giữ nguyên KHÔNG phải hạ', () => {
    expect(laHaChucNang(null, 'khach')).toBe(false);
    expect(laHaChucNang(null, 'admin')).toBe(false);
    expect(laHaChucNang('sales', 'admin')).toBe(false);
    expect(laHaChucNang('khach', 'sales')).toBe(false);
    expect(laHaChucNang('sales', 'kho')).toBe(false);
    expect(laHaChucNang('kho', 'kho')).toBe(false);
  });
});

describe('hạ vai / khoá trạng thái nhân viên', () => {
  it('admin → vai khác, bất kỳ → cong_ty, kho → sales là hạ', () => {
    expect(laHaVai('admin', 'sales')).toBe(true);
    expect(laHaVai('sales', 'cong_ty')).toBe(true);
    expect(laHaVai('kho', 'sales')).toBe(true);
    expect(laHaVai('kho', 'ke_toan')).toBe(true);
  });
  it('sales → kho, cong_ty → sales, giữ nguyên KHÔNG phải hạ', () => {
    expect(laHaVai('sales', 'kho')).toBe(false);
    expect(laHaVai('cong_ty', 'sales')).toBe(false);
    expect(laHaVai('sales', 'admin')).toBe(false);
    expect(laHaVai('ke_toan', 'ke_toan')).toBe(false);
  });
  it('hoat_dong → khoa/nghi và khoa → nghi là khoá; mở lại thì không', () => {
    expect(laHaTrangThai('hoat_dong', 'khoa')).toBe(true);
    expect(laHaTrangThai('hoat_dong', 'nghi')).toBe(true);
    expect(laHaTrangThai('khoa', 'nghi')).toBe(true);
    expect(laHaTrangThai('nghi', 'khoa')).toBe(false);
    expect(laHaTrangThai('khoa', 'hoat_dong')).toBe(false);
    expect(laHaTrangThai('hoat_dong', 'hoat_dong')).toBe(false);
  });
  it('TẠO nhân viên ở trạng thái khoa/nghi hoặc vai cong_ty là khoá (đồng bộ sẽ khoá actor bot sẵn có)', () => {
    expect(laKhoaKhiTao('sales', 'khoa')).toBe(true);
    expect(laKhoaKhiTao('admin', 'nghi')).toBe(true);
    expect(laKhoaKhiTao('cong_ty', 'hoat_dong')).toBe(true);
    expect(laKhoaKhiTao('sales', 'hoat_dong')).toBe(false);
    expect(laKhoaKhiTao('admin', 'hoat_dong')).toBe(false);
  });
  it('admin hoạt động = vai admin VÀ trạng thái hoat_dong', () => {
    expect(laAdminHoatDong({ vai: 'admin', trangThai: 'hoat_dong' })).toBe(true);
    expect(laAdminHoatDong({ vai: 'admin', trangThai: 'khoa' })).toBe(false);
    expect(laAdminHoatDong({ vai: 'sales', trangThai: 'hoat_dong' })).toBe(false);
  });
});

describe('phiên bản cấu hình công khai (phien_ban)', () => {
  const nhom = [
    { conversationId: 'c-2', externalThreadId: 'g2', nickUid: 'nick-hn', chucNang: 'sales', tenDangKy: 'Sales HN' },
    { conversationId: 'c-1', externalThreadId: 'g1', nickUid: null, chucNang: 'admin', tenDangKy: '' },
  ];
  const nv = [
    { zaloUid: '900', tenGoi: 'Hùng', vai: 'kho', trangThai: 'hoat_dong' },
    { zaloUid: '100', tenGoi: 'Quyết', vai: 'admin', trangThai: 'hoat_dong' },
  ];

  it('JSON chuẩn: khoá sắp xếp đệ quy, mảng giữ thứ tự', () => {
    expect(jsonChuan({ b: 1, a: { d: [3, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,1]},"b":1}');
  });

  it('snake_case, sắp theo conversation_id / zalo_uid, đúng bộ khoá', () => {
    const ch = ghepCauHinhCongKhai(nhom, nv);
    expect(Object.keys(ch)).toEqual(['phien_ban', 'nhom', 'nhan_vien']);
    expect(ch.nhom).toEqual([
      { conversation_id: 'c-1', external_thread_id: 'g1', nick_uid: null, chuc_nang: 'admin', ten_dang_ky: '', mac_dinh: false },
      { conversation_id: 'c-2', external_thread_id: 'g2', nick_uid: 'nick-hn', chuc_nang: 'sales', ten_dang_ky: 'Sales HN', mac_dinh: false },
    ]);
    // Thứ tự khoá trong một phần tử là một phần hợp đồng (docs/77 §3.2 + vòng sửa 1).
    expect(Object.keys(ch.nhom[0])).toEqual(['conversation_id', 'external_thread_id', 'nick_uid', 'chuc_nang', 'ten_dang_ky', 'mac_dinh']);
    expect(Object.keys(ch.nhan_vien[0])).toEqual(['zalo_uid', 'ten_goi', 'vai', 'trang_thai']);
    expect(ch.nhan_vien).toEqual([
      { zalo_uid: '100', ten_goi: 'Quyết', vai: 'admin', trang_thai: 'hoat_dong' },
      { zalo_uid: '900', ten_goi: 'Hùng', vai: 'kho', trang_thai: 'hoat_dong' },
    ]);
    expect(ch.phien_ban).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cùng dữ liệu (kể cả khác thứ tự đầu vào) ⇒ cùng phien_ban', () => {
    const a = ghepCauHinhCongKhai(nhom, nv).phien_ban;
    const b = ghepCauHinhCongKhai([...nhom].reverse(), [...nv].reverse()).phien_ban;
    expect(a).toBe(b);
  });

  it('đổi bất kỳ ô nào ⇒ đổi phien_ban', () => {
    const goc = ghepCauHinhCongKhai(nhom, nv).phien_ban;
    const doiVai = ghepCauHinhCongKhai(nhom, [{ ...nv[0], vai: 'sales' }, nv[1]]).phien_ban;
    const doiTrangThai = ghepCauHinhCongKhai(nhom, [{ ...nv[0], trangThai: 'nghi' }, nv[1]]).phien_ban;
    const doiTen = ghepCauHinhCongKhai([{ ...nhom[0], tenDangKy: 'Sales HCM' }, nhom[1]], nv).phien_ban;
    const boNhom = ghepCauHinhCongKhai([nhom[0]], nv).phien_ban;
    const rong = ghepCauHinhCongKhai([], []).phien_ban;
    const doiNick = ghepCauHinhCongKhai([{ ...nhom[0], nickUid: 'nick-hcm' }, nhom[1]], nv).phien_ban;
    const nickNull = ghepCauHinhCongKhai([{ ...nhom[0], nickUid: null }, nhom[1]], nv).phien_ban;
    // docs/77 §8: cùng chức năng mà đổi nguồn (tường minh ↔ mặc định) cũng đổi phiên bản.
    const thanhMacDinh = ghepCauHinhCongKhai([{ ...nhom[0], macDinh: true }, nhom[1]], nv).phien_ban;
    const tatCa = new Set([goc, doiVai, doiTrangThai, doiTen, boNhom, rong, doiNick, nickNull, thanhMacDinh]);
    expect(tatCa.size).toBe(9);
  });
});
