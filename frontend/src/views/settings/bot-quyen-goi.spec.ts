// SPDX-License-Identifier: AGPL-3.0-or-later
// Xưng hô NV (docs/79 T1) — câu gợi ý + chọn dòng áp hàng loạt (chỉ gợi ý KHOÁ TAY, chỉ dòng CHƯA chọn).
import { describe, it, expect } from 'vitest';
import { nhanGoi, cauGoiY, cauKhongGoiY, coGoiYKhac, dongApHangLoat } from './bot-quyen-goi';

const nv = (them: Record<string, unknown>) => ({ id: 'x', goi: null, goiGoiY: null, goiNguon: null, goiGoiYLyDo: null, ...them }) as never;

describe('bot-quyen-goi', () => {
  it('nhanGoi', () => {
    expect(nhanGoi('anh')).toBe('Anh');
    expect(nhanGoi('chi')).toBe('Chị');
    expect(nhanGoi(null)).toBe('');
  });

  it('cauGoiY theo nguồn', () => {
    expect(cauGoiY(nv({ goiGoiY: 'anh', goiNguon: 'khoa_tay' }))).toBe('Gợi ý: Anh (theo giới tính Zalo đã xác nhận)');
    expect(cauGoiY(nv({ goiGoiY: 'chi', goiNguon: 'zalo_tu_dien' }))).toBe('Gợi ý: Chị (theo Zalo tự điền — chưa ai xác nhận)');
    expect(cauGoiY(nv({}))).toBe('');
  });

  it('cauKhongGoiY: chỉ nói khi mâu thuẫn / khoá "khác"; chưa có giới ⇒ im', () => {
    expect(cauKhongGoiY(nv({ goiGoiYLyDo: 'mau_thuan_khoa_tay' }))).toContain('mâu thuẫn');
    expect(cauKhongGoiY(nv({ goiGoiYLyDo: 'mau_thuan_zalo' }))).toContain('mâu thuẫn');
    expect(cauKhongGoiY(nv({ goiGoiYLyDo: 'khoa_tay_khac' }))).toContain('không phải Nam/Nữ');
    expect(cauKhongGoiY(nv({ goiGoiYLyDo: 'chua_co_gioi' }))).toBe('');
  });

  it('coGoiYKhac: có gợi ý và khác giá trị đang chọn', () => {
    expect(coGoiYKhac(nv({ goiGoiY: 'anh' }))).toBe(true);
    expect(coGoiYKhac(nv({ goi: 'anh', goiGoiY: 'anh' }))).toBe(false);
    expect(coGoiYKhac(nv({ goi: 'chi', goiGoiY: 'anh' }))).toBe(true);
    expect(coGoiYKhac(nv({}))).toBe(false);
  });

  it('dongApHangLoat: chỉ khoá tay + chưa chọn (không bao giờ đè lựa chọn của người)', () => {
    const ds = [
      nv({ id: 'a', goiGoiY: 'anh', goiNguon: 'khoa_tay' }),
      nv({ id: 'b', goiGoiY: 'chi', goiNguon: 'zalo_tu_dien' }),
      nv({ id: 'c', goi: 'anh', goiGoiY: 'chi', goiNguon: 'khoa_tay' }),
      nv({ id: 'd', goiGoiYLyDo: 'mau_thuan_khoa_tay' }),
      nv({ id: 'e', goiGoiY: 'chi', goiNguon: 'khoa_tay' }),
    ];
    expect(dongApHangLoat(ds).map((x: { id: string }) => x.id)).toEqual(['a', 'e']);
  });
});
