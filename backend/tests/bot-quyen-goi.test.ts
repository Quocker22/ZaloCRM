// SPDX-License-Identifier: AGPL-3.0-or-later
// Xưng hô NV / người Zalo (docs/79 T1) — luật THUẦN: giới tính Contact ⇒ gợi ý "Gọi là" (anh/chị).
//   • giá trị NV đã SỬA TAY (genderLocked) thắng giá trị Zalo tự điền;
//   • hai giá trị khác nhau cùng mức ⇒ KHÔNG gợi ý (null + lý do) — gọi sai giới tệ hơn gọi trung tính;
//   • API công khai cho bot (đường khách) CHỈ trả anh/chị khi đã khoá tay.
import { describe, it, expect } from 'vitest';
import { goiTuGioi, tinhGoiGoiY, tinhGoiKhoaTay, laGoi } from '../src/modules/bot-quyen/bot-quyen-goi.js';
import { ghepCauHinhCongKhai } from '../src/modules/bot-quyen/bot-quyen-cong-khai.js';

const k = (gender: string | null) => ({ gender, genderLocked: true });
const t = (gender: string | null) => ({ gender, genderLocked: false });

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
  ] as const)('%s', (_ten, ds, kq) => {
    expect(tinhGoiGoiY(ds as Array<{ gender: string | null; genderLocked: boolean }>)).toEqual(kq);
  });

  it('genderLocked = true nhưng gender rỗng ⇒ coi như không khoá (sửa tay bỏ trống = mở khoá)', () => {
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
  ] as const)('%s', (_ten, ds, kq) => {
    expect(tinhGoiKhoaTay(ds as Array<{ gender: string | null; genderLocked: boolean }>)).toEqual(kq);
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
