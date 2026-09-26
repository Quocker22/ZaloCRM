// SPDX-License-Identifier: AGPL-3.0-or-later
// may-in-lich-su.ts — chữ hai thẻ "Đã in" / "Đã huỷ", số trên thẻ, dòng trạng thái, cửa sổ 30 ngày.
import { describe, it, expect } from 'vitest';
import {
  CHU_LICH_SU, SO_NGAY_LICH_SU, chipLichSu, dinhDangSo, soTrenThe, dongTrangThaiLichSu, locTrongCuaSo, mocGio,
} from './may-in-lich-su';

describe('CHU_LICH_SU', () => {
  it('30 ngày; "Đã huỷ" nói rõ CHẮC CHẮN không in và KHÔNG lẫn "bỏ khỏi hàng đợi"', () => {
    expect(SO_NGAY_LICH_SU).toBe(30);
    expect(CHU_LICH_SU.da_in.moTa).toContain('30 ngày gần nhất');
    expect(CHU_LICH_SU.da_huy.moTa).toContain('chắc chắn không in');
    expect(CHU_LICH_SU.da_huy.phu).toBe('Hoá đơn chắc chắn không in');
    for (const c of Object.values(CHU_LICH_SU)) expect(JSON.stringify(c).toLowerCase()).not.toContain('bỏ khỏi');
    expect([CHU_LICH_SU.da_in.cotKetThuc, CHU_LICH_SU.da_huy.cotKetThuc]).toEqual(['In lúc', 'Huỷ lúc']);
  });

  it('chip: đã in xanh lá, đã huỷ xám; trạng thái lạ → nguyên mã, xám (không bịa "Đã in")', () => {
    expect(chipLichSu('da_in')).toMatchObject({ chu: 'Đã in', mau: 'xanh-la' });
    expect(chipLichSu('da_huy')).toMatchObject({ chu: 'Đã huỷ', mau: 'xam' });
    expect(chipLichSu('bo_qua')).toMatchObject({ chu: 'bo_qua', mau: 'xam' });
    expect(chipLichSu('')).toMatchObject({ chu: '—' });
  });
});

describe('số trên thẻ', () => {
  it('nhóm nghìn kiểu Việt', () => {
    expect([0, 7, 999, 1000, 12345, 1234567].map(dinhDangSo)).toEqual(['0', '7', '999', '1.000', '12.345', '1.234.567']);
    expect(dinhDangSo(Number.NaN)).toBe('');
  });

  it('" (N)" theo thẻ; chưa biết (null) → rỗng — thẻ chỉ hiện chữ', () => {
    expect(soTrenThe({ daIn: 1234, daHuy: 0 }, 'da_in')).toBe(' (1.234)');
    expect(soTrenThe({ daIn: 1234, daHuy: 0 }, 'da_huy')).toBe(' (0)');
    expect(soTrenThe(null, 'da_in')).toBe('');
  });
});

describe('dongTrangThaiLichSu', () => {
  const LUC = Date.parse('2026-09-26T07:05:09.000Z'); // 14:05:09 giờ VN
  it('đủ / một phần / chưa biết tổng; kèm giờ cập nhật (giờ VN)', () => {
    expect(dongTrangThaiLichSu(12, 12, false, null)).toBe('12 hoá đơn');
    expect(dongTrangThaiLichSu(50, 1234, true, null)).toBe('50/1.234 hoá đơn');
    expect(dongTrangThaiLichSu(50, null, true, null)).toBe('50+ hoá đơn');
    expect(dongTrangThaiLichSu(0, 0, false, LUC)).toBe('0 hoá đơn · cập nhật 14:05:09');
  });
});

describe('locTrongCuaSo / mocGio', () => {
  it('bỏ dòng kết thúc TRƯỚC mốc đầu cửa sổ; mốc vắng/hỏng → giữ nguyên', () => {
    const ds = [
      { id: 'a', ketThuc: '2026-09-26T07:00:00.000Z' },
      { id: 'b', ketThuc: '2026-08-27T08:00:00.000Z' },
      { id: 'c', ketThuc: '2026-08-27T07:59:59.999Z' },
    ];
    expect(locTrongCuaSo(ds, '2026-08-27T08:00:00.000Z').map((d) => d.id)).toEqual(['a', 'b']);
    expect(locTrongCuaSo(ds, null)).toHaveLength(3);
    expect(locTrongCuaSo(ds, 'rac')).toHaveLength(3);
  });

  it('giờ VN + tương đối', () => {
    expect(mocGio('2026-09-26T06:53:00.000Z', Date.parse('2026-09-26T07:05:00.000Z'))).toEqual({
      gio: '26/09 13:53:00', tuongDoi: '12 phút trước',
    });
  });
});
