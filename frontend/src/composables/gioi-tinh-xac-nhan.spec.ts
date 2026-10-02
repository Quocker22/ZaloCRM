// SPDX-License-Identifier: AGPL-3.0-or-later
// docs/79 T1 — form hồ sơ chỉ gửi `gender` khi ô giới tính THỰC ĐỔI (backend đóng dấu xác nhận theo đó).
import { describe, it, expect } from 'vitest';
import { truongGioiDeGui, trangThaiGioi } from './gioi-tinh-xac-nhan';

describe('truongGioiDeGui', () => {
  it('không đổi ⇒ không gửi gender (lưu SĐT / ghi chú không bao giờ đóng dấu)', () => {
    expect(truongGioiDeGui('male', 'male')).toEqual({});
    expect(truongGioiDeGui(null, null)).toEqual({});
    expect(truongGioiDeGui('', null)).toEqual({});
  });
  it('đổi ⇒ gửi đúng giá trị mới; bỏ trống ⇒ null', () => {
    expect(truongGioiDeGui('female', 'male')).toEqual({ gender: 'female' });
    expect(truongGioiDeGui('male', null)).toEqual({ gender: 'male' });
    expect(truongGioiDeGui(null, 'male')).toEqual({ gender: null });
    expect(truongGioiDeGui('', 'female')).toEqual({ gender: null });
  });
});

describe('trangThaiGioi', () => {
  it('có dấu ⇒ da_xac_nhan; có giới chưa dấu ⇒ chua_xac_nhan; trống ⇒ trong', () => {
    expect(trangThaiGioi('male', '2026-10-02T00:00:00Z')).toBe('da_xac_nhan');
    expect(trangThaiGioi('male', null)).toBe('chua_xac_nhan');
    expect(trangThaiGioi(null, null)).toBe('trong');
    expect(trangThaiGioi('', '2026-10-02T00:00:00Z')).toBe('trong');
  });
});
