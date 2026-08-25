// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest';
import { thamSoKyOdoo } from '../../../src/modules/ai/odoo/ky-odoo.js';
import { giaiKy } from '../../../src/modules/ai/odoo/ky-thoi-gian.js';

const BAY_GIO = new Date('2026-08-25T08:00:00Z'); // 15:00 25/08/2026 VN, thứ Ba

describe('giaiKy — kỳ mới 25/08', () => {
  it('quý này: 01/07 → hôm nay', () => {
    expect(giaiKy('quy_nay', BAY_GIO)).toEqual({ tu: '2026-07-01', den: '2026-08-25' });
  });
  it('năm nay: 01/01 → hôm nay', () => {
    expect(giaiKy('nam_nay', BAY_GIO)).toEqual({ tu: '2026-01-01', den: '2026-08-25' });
  });
  it('6 tháng qua = 6 tháng lịch kể cả tháng này: 01/03 → hôm nay', () => {
    expect(giaiKy('6_thang_qua', BAY_GIO)).toEqual({ tu: '2026-03-01', den: '2026-08-25' });
  });
  it('12 tháng qua vắt qua năm: 01/09/2025', () => {
    expect(giaiKy('12_thang_qua', BAY_GIO).tu).toBe('2025-09-01');
  });
});

describe('thamSoKyOdoo — dịch kỳ bot sang tham số dashboard', () => {
  it('preset Odoo có sẵn → giao Odoo tự tính (không gửi ngày)', () => {
    expect(thamSoKyOdoo({ ky: 'thang_truoc' }, BAY_GIO)).toMatchObject({ time_preset: 'last_month' });
    expect(thamSoKyOdoo({ ky: 'hom_nay' }, BAY_GIO).date_from).toBeUndefined();
  });
  it('kỳ dài (quý này) → custom, date_to LOẠI TRỪ = hôm nay + 1', () => {
    const p = thamSoKyOdoo({ ky: 'quy_nay' }, BAY_GIO);
    expect(p).toMatchObject({ time_preset: 'custom', date_from: '2026-07-01', date_to: '2026-08-26' });
  });
  it('ngày cụ thể một ngày "hôm 20/7" → custom 20/7 → 21/7 (không mất ngày cuối)', () => {
    const p = thamSoKyOdoo({ tu_ngay: '2026-07-20' }, BAY_GIO);
    expect(p).toMatchObject({ time_preset: 'custom', date_from: '2026-07-20', date_to: '2026-07-21' });
  });
  it('không nói gì → mặc định tháng này (preset Odoo)', () => {
    expect(thamSoKyOdoo({}, BAY_GIO).time_preset).toBe('this_month');
  });
  it('tuần này (Odoo không có preset) → custom từ thứ Hai', () => {
    const p = thamSoKyOdoo({ ky: 'tuan_nay' }, BAY_GIO);
    expect(p).toMatchObject({ time_preset: 'custom', date_from: '2026-08-24', date_to: '2026-08-26' });
  });
});
