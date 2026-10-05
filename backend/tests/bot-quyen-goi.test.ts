// SPDX-License-Identifier: AGPL-3.0-or-later
// Xưng hô NV / người Zalo (docs/79 T1) — luật THUẦN: giới tính Contact ⇒ gợi ý "Gọi là" (anh/chị).
//   • giá trị NV đã XÁC NHẬN (Contact.gioiTinhXacNhanLuc — chỉ đặt khi NV ĐỔI ô giới tính) thắng giá trị Zalo tự điền;
//     genderLocked KHÔNG có dấu xác nhận (khoá cũ — form lưu cả form từng khoá mọi giới) ⇒ coi như Zalo tự điền;
//   • hai giá trị khác nhau cùng mức ⇒ KHÔNG gợi ý (null + lý do) — gọi sai giới tệ hơn gọi trung tính;
//   • API công khai cho bot (đường khách) CHỈ trả anh/chị khi đã khoá tay.
import { describe, it, expect } from 'vitest';
import { goiTuGioi, tinhGoiGoiY, tinhGoiKhoaTay, laGoi, goiHieuLuc } from '../src/modules/bot-quyen/bot-quyen-goi.js';
import { ghepCauHinhCongKhai } from '../src/modules/bot-quyen/bot-quyen-cong-khai.js';

const LUC = new Date('2026-10-02T00:00:00Z');
/** NV đã xác nhận (đổi ô giới tính ⇒ khoá + dấu). */
const k = (gender: string | null) => ({ gender, genderLocked: true, gioiTinhXacNhanLuc: LUC });
/** Zalo tự điền (không khoá, không dấu). */
const t = (gender: string | null) => ({ gender, genderLocked: false, gioiTinhXacNhanLuc: null });
/** Khoá CŨ không có dấu xác nhận — form lưu cả form từng đặt genderLocked cho mọi lần bấm Lưu ⇒ KHÔNG tin. */
const kc = (gender: string | null) => ({ gender, genderLocked: true, gioiTinhXacNhanLuc: null });
type G = Array<{ gender: string | null; genderLocked: boolean; gioiTinhXacNhanLuc: Date | null }>;

describe('goiTuGioi', () => {
  it.each([
    ['male', 'anh'], ['female', 'chi'], ['MALE', 'anh'], [' female ', 'chi'],
    ['other', null], ['unknown', null], ['', null], [null, null],
  ] as const)('%s ⇒ %s', (g, kq) => {
    expect(goiTuGioi(g)).toBe(kq);
  });
});

describe('laGoi', () => {
  it('chỉ nhận anh | chi', () => {
    expect(laGoi('anh')).toBe(true);
    expect(laGoi('chi')).toBe(true);
    for (const x of ['chị', 'Anh', '', null, undefined, 1]) expect(laGoi(x)).toBe(false);
  });
});

describe('tinhGoiGoiY — bảng gợi ý cho NV', () => {
  it.each([
    ['không có Contact nào', [], { goi: null, nguon: null, lyDo: 'chua_co_gioi' }],
    ['Contact không có giới', [t(null), t('unknown')], { goi: null, nguon: null, lyDo: 'chua_co_gioi' }],
    ['một giá trị Zalo tự điền (nam)', [t('male')], { goi: 'anh', nguon: 'zalo_tu_dien', lyDo: null }],
    ['Zalo tự điền trùng nhau ở hai nick', [t('female'), t('female')], { goi: 'chi', nguon: 'zalo_tu_dien', lyDo: null }],
    ['Zalo tự điền MÂU THUẪN', [t('male'), t('female')], { goi: null, nguon: null, lyDo: 'mau_thuan_zalo' }],
    ['khoá tay (nữ)', [k('female')], { goi: 'chi', nguon: 'khoa_tay', lyDo: null }],
    ['khoá tay THẮNG Zalo tự điền khác', [k('female'), t('male'), t('male')], { goi: 'chi', nguon: 'khoa_tay', lyDo: null }],
    ['khoá tay thắng cả khi Zalo tự điền mâu thuẫn', [k('male'), t('male'), t('female')], { goi: 'anh', nguon: 'khoa_tay', lyDo: null }],
    ['hai giá trị khoá tay MÂU THUẪN', [k('male'), k('female'), t('male')], { goi: null, nguon: null, lyDo: 'mau_thuan_khoa_tay' }],
    ['khoá tay "khác" (không anh/chị) ⇒ không lấy Zalo tự điền', [k('other'), t('male')], { goi: null, nguon: null, lyDo: 'khoa_tay_khac' }],
    ['khoá tay "khác" + khoá tay nam ⇒ mâu thuẫn', [k('other'), k('male')], { goi: null, nguon: null, lyDo: 'mau_thuan_khoa_tay' }],
    ['khoá CŨ không dấu xác nhận ⇒ hạng Zalo tự điền', [kc('female')], { goi: 'chi', nguon: 'zalo_tu_dien', lyDo: null }],
    ['khoá cũ không dấu KHÔNG thắng Zalo tự điền khác ⇒ mâu thuẫn Zalo', [kc('female'), t('male')], { goi: null, nguon: null, lyDo: 'mau_thuan_zalo' }],
    ['đã xác nhận thắng khoá cũ không dấu', [k('male'), kc('female')], { goi: 'anh', nguon: 'khoa_tay', lyDo: null }],
  ] as const)('%s', (_ten, ds, kq) => {
    expect(tinhGoiGoiY(ds as unknown as G)).toEqual(kq);
  });

  it('có dấu xác nhận nhưng gender rỗng ⇒ coi như chưa xác nhận (sửa tay bỏ trống = mở khoá)', () => {
    expect(tinhGoiGoiY([k(null), t('male')])).toEqual({ goi: 'anh', nguon: 'zalo_tu_dien', lyDo: null });
    expect(tinhGoiGoiY([k('')])).toEqual({ goi: null, nguon: null, lyDo: 'chua_co_gioi' });
  });
});

describe('tinhGoiKhoaTay — API công khai (đường khách): CHỈ giá trị khoá tay', () => {
  it.each([
    ['không có Contact', [], { goi: null, nguon: null }],
    ['chỉ Zalo tự điền ⇒ null (không tin giới tự điền)', [t('male')], { goi: null, nguon: null }],
    ['khoá tay nam', [k('male'), t('female')], { goi: 'anh', nguon: 'khoa_tay' }],
    ['khoá tay nữ (hai Contact trùng)', [k('female'), k('female')], { goi: 'chi', nguon: 'khoa_tay' }],
    ['khoá tay mâu thuẫn ⇒ null', [k('female'), k('male')], { goi: null, nguon: null }],
    ['khoá tay "khác" ⇒ null', [k('other')], { goi: null, nguon: null }],
    ['khoá CŨ không dấu xác nhận ⇒ null (không tin)', [kc('male')], { goi: null, nguon: null }],
    ['khoá cũ không dấu + khoá cũ không dấu trùng ⇒ vẫn null', [kc('female'), kc('female')], { goi: null, nguon: null }],
  ] as const)('%s', (_ten, ds, kq) => {
    expect(tinhGoiKhoaTay(ds as unknown as G)).toEqual(kq);
  });
});

describe('payload công khai: nhan_vien[].goi', () => {
  const nv = (goi?: string | null) => [{ zaloUid: '100', tenGoi: 'Quyết', vai: 'admin', trangThai: 'hoat_dong', goi }];
  it('anh/chi đi thẳng; thiếu / lạ ⇒ null (khoá LUÔN có)', () => {
    expect(ghepCauHinhCongKhai([], nv('anh')).nhan_vien[0].goi).toBe('anh');
    expect(ghepCauHinhCongKhai([], nv('chi')).nhan_vien[0].goi).toBe('chi');
    expect(ghepCauHinhCongKhai([], nv(null)).nhan_vien[0]).toHaveProperty('goi', null);
    expect(ghepCauHinhCongKhai([], nv()).nhan_vien[0]).toHaveProperty('goi', null);
    expect(ghepCauHinhCongKhai([], nv('chị')).nhan_vien[0].goi).toBeNull();
  });
  it('đổi goi ⇒ đổi phien_ban; null và thiếu ⇒ cùng phien_ban', () => {
    const p = (g?: string | null) => ghepCauHinhCongKhai([], nv(g)).phien_ban;
    expect(new Set([p('anh'), p('chi'), p(null)]).size).toBe(3);
    expect(p(undefined)).toBe(p(null));
  });
});

describe('tinhGoiGoiY — mức thấp nhất: giới tính HỒ SƠ ZALO (vòng danh tính, 05/10)', () => {
  it.each([
    ['chỉ hồ sơ Zalo (nữ) — NV không có Contact', [], ['female'], { goi: 'chi', nguon: 'zalo_ho_so', lyDo: null }],
    ['hồ sơ trùng nhau ở hai nick', [], ['male', 'male'], { goi: 'anh', nguon: 'zalo_ho_so', lyDo: null }],
    ['hồ sơ MÂU THUẪN ⇒ null', [], ['male', 'female'], { goi: null, nguon: null, lyDo: 'mau_thuan_ho_so' }],
    ['hồ sơ trống / lạ ⇒ chưa có giới', [], [null, 'other'], { goi: null, nguon: null, lyDo: 'chua_co_gioi' }],
    ['Zalo tự điền (Contact) THẮNG hồ sơ khác', [t('male')], ['female'], { goi: 'anh', nguon: 'zalo_tu_dien', lyDo: null }],
    ['đã xác nhận THẮNG hồ sơ khác', [k('female')], ['male'], { goi: 'chi', nguon: 'khoa_tay', lyDo: null }],
    ['Contact mâu thuẫn ⇒ null, KHÔNG rơi xuống hồ sơ', [t('male'), t('female')], ['male'], { goi: null, nguon: null, lyDo: 'mau_thuan_zalo' }],
    ['khoá tay "khác" ⇒ không lấy hồ sơ', [k('other')], ['male'], { goi: null, nguon: null, lyDo: 'khoa_tay_khac' }],
    ['Contact không có giới ⇒ dùng hồ sơ', [t(null)], ['female'], { goi: 'chi', nguon: 'zalo_ho_so', lyDo: null }],
  ] as const)('%s', (_ten, ds, hoSo, kq) => {
    expect(tinhGoiGoiY(ds as unknown as G, hoSo as unknown as string[])).toEqual(kq);
  });

  it('API công khai cho KHÁCH vẫn chỉ khoá tay (không có tham số hồ sơ)', () => {
    expect(tinhGoiKhoaTay([t('male')])).toEqual({ goi: null, nguon: null });
  });
});

describe('goiHieuLuc — giá trị bot DÙNG cho NV (payload công khai)', () => {
  const y = (goi: 'anh' | 'chi' | null) => ({ goi });
  it('chủ chọn tay ĐÈ gợi ý', () => {
    expect(goiHieuLuc('anh', y('chi'))).toBe('anh');
    expect(goiHieuLuc('chi', y(null))).toBe('chi');
  });
  it('trống / lạ ⇒ gợi ý (mọi nguồn); không có gợi ý ⇒ null', () => {
    expect(goiHieuLuc(null, y('chi'))).toBe('chi');
    expect(goiHieuLuc(undefined, y('anh'))).toBe('anh');
    expect(goiHieuLuc('chị', y('anh'))).toBe('anh');
    expect(goiHieuLuc(null, y(null))).toBeNull();
    expect(goiHieuLuc(null, undefined)).toBeNull();
  });
  it('payload: goi = chủ chọn ?? gợi ý ⇒ đổi gợi ý cũng đổi phien_ban', () => {
    const nv = (goi: string | null) => [{ zaloUid: '100', tenGoi: 'Ánh', vai: 'sales', trangThai: 'hoat_dong', goi }];
    const tuDong = ghepCauHinhCongKhai([], nv(goiHieuLuc(null, y('chi'))));
    expect(tuDong.nhan_vien[0].goi).toBe('chi');
    const chuDe = ghepCauHinhCongKhai([], nv(goiHieuLuc('anh', y('chi'))));
    expect(chuDe.nhan_vien[0].goi).toBe('anh');
    expect(chuDe.phien_ban).not.toBe(tuDong.phien_ban);
  });
});
