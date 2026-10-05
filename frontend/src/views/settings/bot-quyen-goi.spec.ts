// SPDX-License-Identifier: AGPL-3.0-or-later
// Xưng hô NV (docs/79 T1; TỰ ĐỘNG 05/10) — mục "Tự động" của ô chọn + câu gợi ý theo nguồn.
import { describe, it, expect } from 'vitest';
import { nhanGoi, cauGoiY, cauKhongGoiY, coGoiYKhac, cauTuDong, dsGoiCua, goiDangDung } from './bot-quyen-goi';

const nv = (them: Record<string, unknown>) => ({ id: 'x', goi: null, goiGoiY: null, goiNguon: null, goiGoiYLyDo: null, ...them }) as never;

describe('bot-quyen-goi', () => {
  it('nhanGoi', () => {
    expect(nhanGoi('anh')).toBe('Anh');
    expect(nhanGoi('chi')).toBe('Chị');
    expect(nhanGoi(null)).toBe('');
  });

  it('cauTuDong / dsGoiCua: mục "Tự động" nêu giá trị + nguồn; chưa biết giới ⇒ "anh/chị"', () => {
    expect(cauTuDong(nv({ goiGoiY: 'anh', goiNguon: 'khoa_tay' }))).toBe('Tự động — Anh (đã xác nhận)');
    expect(cauTuDong(nv({ goiGoiY: 'chi', goiNguon: 'zalo_tu_dien' }))).toBe('Tự động — Chị (theo Zalo)');
    expect(cauTuDong(nv({ goiGoiY: 'anh', goiNguon: 'zalo_ho_so' }))).toBe('Tự động — Anh (theo hồ sơ Zalo)');
    expect(cauTuDong(nv({}))).toBe('Tự động — “anh/chị”');
    expect(dsGoiCua(nv({ goiGoiY: 'chi', goiNguon: 'zalo_ho_so' })).map((x) => x.value)).toEqual(['', 'anh', 'chi']);
  });

  it('goiDangDung: chọn tay thắng; trống ⇒ gợi ý; không có ⇒ null', () => {
    expect(goiDangDung(nv({ goi: 'anh', goiGoiY: 'chi' }))).toBe('anh');
    expect(goiDangDung(nv({ goiGoiY: 'chi' }))).toBe('chi');
    expect(goiDangDung(nv({}))).toBeNull();
  });

  it('cauGoiY theo nguồn', () => {
    expect(cauGoiY(nv({ goiGoiY: 'anh', goiNguon: 'khoa_tay' }))).toBe('Gợi ý: Anh (theo giới tính Zalo đã xác nhận)');
    expect(cauGoiY(nv({ goiGoiY: 'chi', goiNguon: 'zalo_tu_dien' }))).toBe('Gợi ý: Chị (theo Zalo tự điền — chưa ai xác nhận)');
    expect(cauGoiY(nv({ goiGoiY: 'chi', goiNguon: 'zalo_ho_so' }))).toBe('Gợi ý: Chị (theo hồ sơ Zalo)');
    expect(cauGoiY(nv({}))).toBe('');
  });

  it('cauKhongGoiY: chỉ nói khi mâu thuẫn / khoá "khác"; chưa có giới ⇒ im', () => {
    expect(cauKhongGoiY(nv({ goiGoiYLyDo: 'mau_thuan_khoa_tay' }))).toContain('mâu thuẫn');
    expect(cauKhongGoiY(nv({ goiGoiYLyDo: 'mau_thuan_zalo' }))).toContain('mâu thuẫn');
    expect(cauKhongGoiY(nv({ goiGoiYLyDo: 'mau_thuan_ho_so' }))).toContain('mâu thuẫn');
    expect(cauKhongGoiY(nv({ goiGoiYLyDo: 'khoa_tay_khac' }))).toContain('không phải Nam/Nữ');
    expect(cauKhongGoiY(nv({ goiGoiYLyDo: 'chua_co_gioi' }))).toBe('');
  });

  it('coGoiYKhac: CHỈ khi đã chọn tay mà gợi ý tự động khác (trống = đang tự động, không cần chip)', () => {
    expect(coGoiYKhac(nv({ goiGoiY: 'anh' }))).toBe(false);
    expect(coGoiYKhac(nv({ goi: 'anh', goiGoiY: 'anh' }))).toBe(false);
    expect(coGoiYKhac(nv({ goi: 'chi', goiGoiY: 'anh' }))).toBe(true);
    expect(coGoiYKhac(nv({ goi: 'chi' }))).toBe(false);
    expect(coGoiYKhac(nv({}))).toBe(false);
  });
});
