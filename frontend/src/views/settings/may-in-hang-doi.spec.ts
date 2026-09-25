// SPDX-License-Identifier: AGPL-3.0-or-later
// Hàm thuần của thẻ "Hàng đợi in" + chip "N đang chờ" (hợp đồng hàng đợi/huỷ v5.1 §6.1, §8).
import { describe, it, expect } from 'vitest';
import type { KetQuaHuy, MucHangDoi } from '@/api/print-agents';
import {
  chipTrangThaiHangDoi, demChoInTheoMay, lyDoKhongHuy, tomTatHuy, cauXacNhanHuy, choTu, chiaLo, phanLoaiLoiGoi, cauTuChoi,
  thongBaoConDung, LY_DO_KHONG_HUY, CAU_BO_THEO_DOI, CAU_CHUA_RO_HUY, TRE_GUI_LAI_MS,
} from './may-in-hang-doi';
import { chonTabNhatKy } from './may-in-nhat-ky-app';

const muc = (id: string, them: Partial<MucHangDoi> = {}): MucHangDoi => ({
  id, soHoaDon: `INV/${id}`, tenKhach: null, mayInId: 'm1', mayInTen: 'Máy HN', trangThai: 'cho_in', nhom: 'cho_in',
  lyDo: 'Chờ tới lượt in', tamGiu: false, lanThu: 0, tao: '2026-09-25T02:48:00.000Z', capNhat: '2026-09-25T02:48:00.000Z',
  huy: 'chac_chan', ...them,
});
const kq = (id: string, ok: boolean): KetQuaHuy => ({ id, soHoaDon: `INV/${id}`, ok, trangThaiMoi: ok ? 'da_huy' : 'dang_gui', noiDung: 'x' });

describe('demChoInTheoMay — chip "N đang chờ" CHỈ đếm nhóm choIn', () => {
  it('đếm theo máy, cam khi có tạm giữ; chưa xác nhận không tính', () => {
    const m = demChoInTheoMay({
      choIn: [muc('a'), muc('b', { tamGiu: true }), muc('c', { mayInId: 'm2' }), muc('d', { mayInId: null })],
      chuaXacNhan: [muc('k', { trangThai: 'khong_ro', nhom: 'chua_xac_nhan' }), muc('k2', { mayInId: 'm3', trangThai: 'khong_ro' })],
      capNhat: '',
    });
    expect(m.get('m1')).toEqual({ soLuong: 2, tamGiu: true });
    expect(m.get('m2')).toEqual({ soLuong: 1, tamGiu: false });
    expect(m.get('')).toEqual({ soLuong: 1, tamGiu: false });
    expect(m.has('m3')).toBe(false);
    expect(demChoInTheoMay(null).size).toBe(0);
  });
});

describe('chipTrangThaiHangDoi', () => {
  it('Tạm giữ (cam) / Chờ in / Đang gửi / Đã gửi máy in / Chưa xác nhận — luôn có biểu tượng', () => {
    expect(chipTrangThaiHangDoi(muc('a', { tamGiu: true }))).toMatchObject({ chu: 'Tạm giữ', mau: 'cam' });
    expect(chipTrangThaiHangDoi(muc('a'))).toMatchObject({ chu: 'Chờ in', mau: 'xam' });
    expect(chipTrangThaiHangDoi(muc('a', { trangThai: 'dang_gui' }))).toMatchObject({ chu: 'Đang gửi', mau: 'xanh' });
    expect(chipTrangThaiHangDoi(muc('a', { trangThai: 'da_gui' })).chu).toBe('Đã gửi máy in');
    expect(chipTrangThaiHangDoi(muc('a', { trangThai: 'khong_ro' }))).toMatchObject({ chu: 'Chưa xác nhận', mau: 'vang' });
    expect(chipTrangThaiHangDoi(muc('a', { trangThai: 'la' })).chu).toBe('la');
    for (const t of ['cho_in', 'dang_gui', 'da_gui', 'khong_ro']) expect(chipTrangThaiHangDoi(muc('a', { trangThai: t })).bieuTuong).toMatch(/^mdi-/);
  });
});

describe('lyDoKhongHuy — câu §8.2 theo trạng thái', () => {
  it('đang gửi/đã gửi → "bỏ tờ in ra"; chưa xác nhận → hướng dẫn tắt máy in + Bỏ khỏi hàng đợi', () => {
    expect(lyDoKhongHuy({ trangThai: 'dang_gui' })).toBe(LY_DO_KHONG_HUY.dangIn);
    expect(lyDoKhongHuy({ trangThai: 'da_gui' })).toBe(LY_DO_KHONG_HUY.dangIn);
    expect(LY_DO_KHONG_HUY.dangIn).toContain('Nếu không cần tờ này: bỏ tờ in ra.');
    expect(lyDoKhongHuy({ trangThai: 'khong_ro' })).toBe(LY_DO_KHONG_HUY.chuaXacNhan);
    expect(LY_DO_KHONG_HUY.chuaXacNhan).toContain("Rồi bấm 'Bỏ khỏi hàng đợi'.");
    expect(lyDoKhongHuy({ trangThai: 'da_in' })).toBe(LY_DO_KHONG_HUY.khac);
  });
  it('câu bỏ theo dõi nói rõ KHÔNG chặn việc in và KHÔNG biết đã in hay chưa; không có chữ "huỷ"', () => {
    expect(CAU_BO_THEO_DOI).toContain('KHÔNG chặn việc in');
    expect(CAU_BO_THEO_DOI).toContain('KHÔNG biết hoá đơn đã in hay chưa');
    expect(CAU_BO_THEO_DOI).not.toMatch(/huỷ/i);
  });
});

describe('tomTatHuy — toast tổng', () => {
  it('"Đã huỷ 3/4 lệnh" khi có cái không được; một lệnh thì nói số hoá đơn; không bao giờ nói đã huỷ cái hỏng', () => {
    expect(tomTatHuy([kq('a', true), kq('b', true), kq('c', true), kq('d', false)]))
      .toEqual({ chu: 'Đã huỷ 3/4 lệnh — 1 lệnh không huỷ được (xem từng dòng)', loai: 'warning' });
    expect(tomTatHuy([kq('a', true), kq('b', true)])).toEqual({ chu: 'Đã huỷ 2/2 lệnh', loai: 'success' });
    expect(tomTatHuy([kq('a', false), kq('b', false)])).toEqual({ chu: 'Không huỷ được 2 lệnh — xem lý do ở từng dòng', loai: 'error' });
    expect(tomTatHuy([kq('a', true)])).toEqual({ chu: 'Đã huỷ lệnh in INV/a — hoá đơn chắc chắn không in', loai: 'success' });
    expect(tomTatHuy([kq('a', false)])).toEqual({ chu: 'Không huỷ được lệnh in INV/a — xem lý do ở dòng', loai: 'error' });
  });
  it('lệnh máy chủ từ chối (4xx) / chưa rõ (mất liên lạc) KHÔNG BAO GIỜ được đếm là đã huỷ', () => {
    expect(tomTatHuy([kq('a', true), kq('b', true)], { tuChoi: 50, chuaRo: 3 })).toEqual({
      chu: 'Đã huỷ 2/55 lệnh — 50 lệnh chưa huỷ (máy chủ từ chối), 3 lệnh chưa rõ kết quả (mất liên lạc máy chủ) (xem từng dòng)',
      loai: 'warning',
    });
    expect(tomTatHuy([], { chuaRo: 1 })).toEqual({ chu: 'Chưa rõ kết quả huỷ — không liên lạc được máy chủ (xem dòng)', loai: 'error' });
    expect(tomTatHuy([], { tuChoi: 1 })).toEqual({ chu: 'Chưa huỷ — máy chủ từ chối yêu cầu (xem dòng)', loai: 'error' });
    expect(tomTatHuy([], { chuaRo: 4 }).chu).toBe('Đã huỷ 0/4 lệnh — 4 lệnh chưa rõ kết quả (mất liên lạc máy chủ) (xem từng dòng)');
    expect(tomTatHuy([], { chuaRo: 4 }).loai).toBe('error');
  });
});

describe('cauXacNhanHuy — "Hoá đơn … sẽ KHÔNG được in."', () => {
  it('một và tới 6 hoá đơn: liệt kê đủ trong câu', () => {
    expect(cauXacNhanHuy(['INV/1'])).toEqual({ tieuDe: 'Huỷ lệnh in INV/1?', noiDung: 'Hoá đơn INV/1 sẽ KHÔNG được in.', hienNgay: ['INV/1'], conLai: 0 });
    expect(cauXacNhanHuy(['INV/1', 'INV/2'])).toEqual({
      tieuDe: 'Huỷ 2 lệnh in đã chọn?', noiDung: 'Hoá đơn INV/1, INV/2 sẽ KHÔNG được in.', hienNgay: ['INV/1', 'INV/2'], conLai: 0,
    });
  });
  it('hơn 6: câu nêu SỐ LƯỢNG + danh sách mở được — không có "và N khác" câm', () => {
    const nhieu = cauXacNhanHuy(Array.from({ length: 9 }, (_, i) => `INV/${i}`));
    expect(nhieu.tieuDe).toBe('Huỷ 9 lệnh in đã chọn?');
    expect(nhieu.noiDung).toBe('9 hoá đơn dưới đây sẽ KHÔNG được in:');
    expect(nhieu.hienNgay).toEqual(['INV/0', 'INV/1', 'INV/2', 'INV/3', 'INV/4', 'INV/5']);
    expect(nhieu.conLai).toBe(3);
    expect(nhieu.noiDung).not.toMatch(/khác/);
  });
});

describe('gửi yêu cầu: chia lô ≤ 50, phân loại lỗi, câu "từ chối" / "chưa rõ"', () => {
  it('chiaLo: 120 id → 50 + 50 + 20, giữ thứ tự', () => {
    const lo = chiaLo(Array.from({ length: 120 }, (_, i) => i));
    expect(lo.map((l) => l.length)).toEqual([50, 50, 20]);
    expect(lo[1][0]).toBe(50);
    expect(chiaLo([])).toEqual([]);
  });
  it('4xx (trừ 408/429) = TỪ CHỐI chắc chắn; mất mạng / hết giờ / 5xx / 408 / 429 = gửi lại', () => {
    expect(phanLoaiLoiGoi({ response: { status: 400 } })).toEqual({ loai: 'tu_choi', ma: 400 });
    expect(phanLoaiLoiGoi({ response: { status: 403 } })).toEqual({ loai: 'tu_choi', ma: 403 });
    for (const e of [{ code: 'ECONNABORTED' }, { message: 'Network Error' }, { response: { status: 502 } }, { response: { status: 408 } }, { response: { status: 429 } }, null]) {
      expect(phanLoaiLoiGoi(e)).toEqual({ loai: 'thu_lai' });
    }
    expect(TRE_GUI_LAI_MS).toEqual([1000, 2000, 4000]);
  });
  it('câu từ chối nói rõ CHƯA đổi gì; câu chưa rõ không suy "biến mất = đã huỷ"', () => {
    expect(cauTuChoi(400, 'huy')).toBe('Máy chủ từ chối yêu cầu (mã 400) — CHƯA huỷ gì — hoá đơn vẫn ở hàng đợi. Thử lại, hoặc chọn ít lệnh hơn.');
    expect(cauTuChoi(403, 'bo')).toContain('CHƯA bỏ khỏi hàng đợi');
    expect(CAU_CHUA_RO_HUY).toBe('Chưa rõ — không liên lạc được máy chủ. Xem Nhật ký in để biết hoá đơn đã huỷ hay đã in.');
  });
  it('thongBaoConDung: trạng thái đổi → thông báo cũ hết đúng', () => {
    expect(thongBaoConDung('dang_gui', 'dang_gui')).toBe(true);
    expect(thongBaoConDung('dang_gui', 'cho_in')).toBe(false);   // app trả về, lệnh lại "Tạm giữ"
    expect(thongBaoConDung('dang_gui', undefined)).toBe(false);  // đã rời hàng đợi (in xong…)
    expect(thongBaoConDung('da_in', undefined)).toBe(true);      // "đã in xong" — đúng khi đã rời
    expect(thongBaoConDung(null, undefined)).toBe(true);         // không tìm thấy
    expect(thongBaoConDung(null, 'cho_in')).toBe(false);
  });
});

describe('choTu — giờ VN + tương đối', () => {
  it('"25/09 09:48:00" + "12 phút trước"', () => {
    expect(choTu(muc('a'), Date.parse('2026-09-25T03:00:00.000Z'))).toEqual({ gio: '25/09 09:48:00', tuongDoi: '12 phút trước' });
  });
});

describe('chonTabNhatKy — ba thẻ', () => {
  it('URL thắng; đã nhớ thắng mặc định; mặc định Hàng đợi khi N > 0, ngược lại Nhật ký in', () => {
    expect(chonTabNhatKy('hang_doi', 'in', 0)).toBe('hang_doi');
    expect(chonTabNhatKy('in', 'hang_doi', 5)).toBe('in');
    expect(chonTabNhatKy(null, 'hang_doi', 0)).toBe('hang_doi');
    expect(chonTabNhatKy(null, 'app', 5)).toBe('app');
    expect(chonTabNhatKy(null, null, 3)).toBe('hang_doi');
    expect(chonTabNhatKy(null, null, 0)).toBe('in');
    expect(chonTabNhatKy('xyz', 'abc', 2)).toBe('hang_doi');
    expect(chonTabNhatKy('xyz', 'abc')).toBe('in');
  });
  it('có hoá đơn TẠM GIỮ → Hàng đợi bất kể thẻ đã nhớ; chỉ URL rõ ràng mới thắng', () => {
    expect(chonTabNhatKy(null, 'in', 3, true)).toBe('hang_doi');
    expect(chonTabNhatKy(null, 'app', 1, true)).toBe('hang_doi');
    expect(chonTabNhatKy('in', 'app', 3, true)).toBe('in');
    expect(chonTabNhatKy('app', null, 3, true)).toBe('app');
    expect(chonTabNhatKy(null, 'in', 3, false)).toBe('in');
  });
});
