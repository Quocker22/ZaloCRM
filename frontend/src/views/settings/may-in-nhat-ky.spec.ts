// SPDX-License-Identifier: AGPL-3.0-or-later
// Test hàm thuần của trang Máy in — giờ VN, khoảng lọc, gộp trang, chip tình trạng.
import { describe, it, expect } from 'vitest';
import {
  dinhDangGioVN, thoiGianTuongDoi, dauNgayVN, khoangThoiGian, chuanHoaTuKhoa,
  gopTrangMoi, noiTrangSau, chiTietDep, chipTinhTrang,
} from './may-in-nhat-ky';

const ms = (iso: string) => new Date(iso).getTime();

describe('dinhDangGioVN — giờ Việt Nam (UTC+7)', () => {
  it('đổi UTC sang giờ VN, dạng dd/MM HH:mm:ss', () => {
    expect(dinhDangGioVN('2026-09-24T02:05:09Z')).toBe('24/09 09:05:09');
  });
  it('qua nửa đêm VN thì sang ngày hôm sau', () => {
    expect(dinhDangGioVN('2026-09-24T17:30:00Z')).toBe('25/09 00:30:00');
  });
  it('coNam thêm năm; qua giao thừa đổi năm', () => {
    expect(dinhDangGioVN('2026-12-31T18:00:00Z', { coNam: true })).toBe('01/01/2027 01:00:00');
  });
  it('mốc hỏng → "—"', () => {
    expect(dinhDangGioVN('không phải ngày')).toBe('—');
    expect(dinhDangGioVN(null)).toBe('—');
    expect(dinhDangGioVN('')).toBe('—');
  });
});

describe('thoiGianTuongDoi', () => {
  const bayGio = ms('2026-09-24T10:00:00Z');
  it('dưới 1 phút → vừa xong', () => {
    expect(thoiGianTuongDoi('2026-09-24T09:59:30Z', bayGio)).toBe('vừa xong');
  });
  it('tương lai (đồng hồ lệch) → vừa xong', () => {
    expect(thoiGianTuongDoi('2026-09-24T10:02:00Z', bayGio)).toBe('vừa xong');
  });
  it('phút / giờ / ngày', () => {
    expect(thoiGianTuongDoi('2026-09-24T09:57:00Z', bayGio)).toBe('3 phút trước');
    expect(thoiGianTuongDoi('2026-09-24T07:59:00Z', bayGio)).toBe('2 giờ trước');
    expect(thoiGianTuongDoi('2026-09-19T10:00:00Z', bayGio)).toBe('5 ngày trước');
  });
  it('quá 30 ngày → ngày giờ VN', () => {
    expect(thoiGianTuongDoi('2026-07-01T20:00:00Z', bayGio)).toBe('02/07/2026');
  });
  it('mốc hỏng → chuỗi rỗng', () => {
    expect(thoiGianTuongDoi(undefined, bayGio)).toBe('');
  });
});

describe('khoangThoiGian — theo ngày lịch giờ VN', () => {
  // 24/09 09:00 giờ VN = 02:00Z
  const sang = ms('2026-09-24T02:00:00Z');
  it('Hôm nay = 00:00 VN hôm nay → 23:59:59.999 VN hôm nay', () => {
    expect(khoangThoiGian('hom_nay', sang)).toEqual({
      tu: '2026-09-23T17:00:00.000Z',
      den: '2026-09-24T16:59:59.999Z',
    });
  });
  it('7 ngày = hôm nay + 6 ngày trước', () => {
    expect(khoangThoiGian('7_ngay', sang)).toEqual({
      tu: '2026-09-17T17:00:00.000Z',
      den: '2026-09-24T16:59:59.999Z',
    });
  });
  it('30 ngày', () => {
    expect(khoangThoiGian('30_ngay', sang).tu).toBe('2026-08-25T17:00:00.000Z');
  });
  it('23:30 UTC đã là sáng hôm sau ở VN — "Hôm nay" là ngày VN, không phải ngày UTC', () => {
    // 24/09 23:30Z = 25/09 06:30 VN
    expect(khoangThoiGian('hom_nay', ms('2026-09-24T23:30:00Z')).tu).toBe('2026-09-24T17:00:00.000Z');
  });
  it('đúng 00:00 VN thuộc về ngày mới', () => {
    expect(dauNgayVN(ms('2026-09-24T17:00:00Z'))).toBe(ms('2026-09-24T17:00:00Z'));
    expect(dauNgayVN(ms('2026-09-24T16:59:59.999Z'))).toBe(ms('2026-09-23T17:00:00Z'));
  });
  it('trong cùng một ngày VN, khoảng không đổi (tự làm mới gộp được)', () => {
    const a = khoangThoiGian('7_ngay', ms('2026-09-24T01:00:00Z'));
    const b = khoangThoiGian('7_ngay', ms('2026-09-24T16:00:00Z'));
    expect(a).toEqual(b);
  });
});

describe('chuanHoaTuKhoa — tìm không dấu', () => {
  it('bỏ dấu, chữ thường, đ → d, gộp khoảng trắng', () => {
    expect(chuanHoaTuKhoa('  Lộc   Beco ')).toBe('loc beco');
    expect(chuanHoaTuKhoa('ĐƠN Hết Giấy')).toBe('don het giay');
    expect(chuanHoaTuKhoa('Kẹt giấy')).toBe(chuanHoaTuKhoa('ket GIAY'));
  });
  it('null/rỗng → ""', () => {
    expect(chuanHoaTuKhoa(null)).toBe('');
    expect(chuanHoaTuKhoa('   ')).toBe('');
  });
  it('giữ số và ký tự số hoá đơn', () => {
    expect(chuanHoaTuKhoa('INV/2026/00123')).toBe('inv/2026/00123');
  });
});

describe('gopTrangMoi / noiTrangSau', () => {
  const d = (id: string) => ({ id });
  it('chèn dòng mới lên đầu, giữ phần đã tải thêm', () => {
    const cu = [d('c'), d('b'), d('a')];
    const { ds, datLai } = gopTrangMoi(cu, [d('e'), d('d'), d('c'), d('b')]);
    expect(datLai).toBe(false);
    expect(ds.map((x) => x.id)).toEqual(['e', 'd', 'c', 'b', 'a']);
  });
  it('không có gì mới → giữ nguyên', () => {
    const cu = [d('b'), d('a')];
    expect(gopTrangMoi(cu, [d('b'), d('a')])).toEqual({ ds: cu, datLai: false });
  });
  it('không trùng dòng nào (có thể hở giữa) → đặt lại', () => {
    expect(gopTrangMoi([d('a')], [d('z'), d('y')])).toEqual({ ds: [d('z'), d('y')], datLai: true });
  });
  it('danh sách cũ rỗng → đặt lại', () => {
    expect(gopTrangMoi([], [d('a')]).datLai).toBe(true);
  });
  it('trang sau chồng mép → bỏ dòng trùng', () => {
    expect(noiTrangSau([d('c'), d('b')], [d('b'), d('a')]).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('chiTietDep', () => {
  it('JSON thụt 2', () => {
    expect(chiTietDep({ a: 1 })).toBe('{\n  "a": 1\n}');
  });
  it('rỗng → "", chuỗi giữ nguyên', () => {
    expect(chiTietDep(null)).toBe('');
    expect(chiTietDep(undefined)).toBe('');
    expect(chiTietDep('lỗi thô')).toBe('lỗi thô');
  });
  it('che khoá giống token/mật khẩu (§0.3), kể cả lồng sâu', () => {
    const s = chiTietDep({ token: 'abc123', app: { accessToken: 'x', mayIn: 'HP' }, matKhau: 'p' });
    expect(s).not.toContain('abc123');
    expect(s).not.toContain('"x"');
    expect(s).not.toContain('"p"');
    expect(s).toContain('HP');
  });
  it('vòng tham chiếu không làm vỡ', () => {
    const o: Record<string, unknown> = {};
    o.tu = o;
    expect(typeof chiTietDep(o)).toBe('string');
  });
});

describe('chipTinhTrang — cột Trạng thái', () => {
  const bayGio = ms('2026-09-24T10:00:00Z');
  it('lỗi → đỏ, "Hết giấy · 3 phút trước"', () => {
    const c = chipTinhTrang({ ma: 'het_giay', nhan: 'Hết giấy', luc: '2026-09-24T09:57:00Z' }, bayGio);
    expect(c).toMatchObject({ chu: 'Hết giấy · 3 phút trước', mau: 'error' });
    expect(c?.tieuDe).toContain('24/09/2026 16:57:00');
  });
  it('cảnh báo → vàng', () => {
    expect(chipTinhTrang({ ma: 'het_muc', nhan: 'x', luc: '2026-09-24T09:59:50Z' }, bayGio))
      .toMatchObject({ chu: 'Hết mực / sắp hết mực · vừa xong', mau: 'warning' });
  });
  it('bình thường / null → không có chip', () => {
    expect(chipTinhTrang({ ma: 'binh_thuong', nhan: 'x', luc: '2026-09-24T09:00:00Z' }, bayGio)).toBeNull();
    expect(chipTinhTrang(null, bayGio)).toBeNull();
    expect(chipTinhTrang(undefined, bayGio)).toBeNull();
  });
  it('mã lạ → chip xám với nhãn backend gửi', () => {
    expect(chipTinhTrang({ ma: 'ma_moi', nhan: 'Sự cố mới', luc: '2026-09-24T08:00:00Z' }, bayGio))
      .toMatchObject({ chu: 'Sự cố mới · 2 giờ trước', mau: 'grey' });
  });
  it('thiếu luc → chỉ nhãn', () => {
    expect(chipTinhTrang({ ma: 'ket_giay', nhan: 'Kẹt giấy', luc: null }, bayGio)?.chu).toBe('Kẹt giấy');
  });
});
