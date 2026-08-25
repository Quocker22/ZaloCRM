// SPDX-License-Identifier: AGPL-3.0-or-later
// Bộ lọc dashboard cho bot (25/08) — anh Quốc: trang Báo cáo › Tổng quan "có cả
// filter, khách yêu cầu gì AI cũng phải trả ra được". Kỳ dài/ngày cụ thể/chi
// nhánh/xếp top phải đi xuống Odoo đúng tham số web đang dùng.
import { describe, it, expect, vi } from 'vitest';
import { baoCaoTongQuan, thamSoLocDashboard } from '../../../src/modules/ai/odoo/tools/bao-cao-tong-quan.js';
import { baoCaoBanHang } from '../../../src/modules/ai/odoo/tools/bao-cao-ban-hang.js';

const BAY_GIO = new Date('2026-08-25T08:00:00Z'); // 15:00 25/08/2026 VN

const odooGia = (tra: Record<string, unknown> = {}) => ({
  execute: vi.fn(async () => ({
    kpi: { invoice_count: 3, revenue: 1_000_000 },
    time_range: { df: '2026-07-01', dt: '2026-08-26', preset: 'custom' },
    revenue_chart: [{ label: '01/07', value: 100 }, { label: '02/07', value: 200 }],
    branch_chart: [{ label: 'TT', value: 900 }, { label: 'HCM', value: 100 }],
    top_customers: [{ label: 'Anh Long Led', value: 500 }],
    tabs: [],
    ...tra,
  })),
});

describe('thamSoLocDashboard', () => {
  it('preset Odoo giữ nguyên, không thêm gì (test cũ toMatchObject vẫn đúng)', () => {
    expect(thamSoLocDashboard({ ky: 'last_month' }, BAY_GIO).kwargs).toEqual({ time_preset: 'last_month' });
    expect(thamSoLocDashboard({}, BAY_GIO).kwargs).toEqual({ time_preset: 'this_month' });
  });
  it('quý này → custom + date_to loại trừ; chi nhánh HCM → warehouse_ids [3]', () => {
    const { kwargs, chiNhanh } = thamSoLocDashboard({ ky: 'quy_nay', chi_nhanh: 'hcm' }, BAY_GIO);
    expect(kwargs).toEqual({ time_preset: 'custom', date_from: '2026-07-01', date_to: '2026-08-26', warehouse_ids: [3] });
    expect(chiNhanh).toBe('HCM');
  });
  it('ngày cụ thể từ 1/8 đến 5/8 → custom 2026-08-01 → 2026-08-06', () => {
    expect(thamSoLocDashboard({ tu_ngay: '2026-08-01', den_ngay: '2026-08-05' }, BAY_GIO).kwargs)
      .toMatchObject({ time_preset: 'custom', date_from: '2026-08-01', date_to: '2026-08-06' });
  });
  it('chi nhánh lạ ("Đà Nẵng") → không lọc, không bịa id', () => {
    expect(thamSoLocDashboard({ chi_nhanh: 'DN' }, BAY_GIO).kwargs.warehouse_ids).toBeUndefined();
  });
});

describe('baoCaoTongQuan + bộ lọc web', () => {
  it('top theo số đơn → top_customer_by/top_staff_by = orders; biểu đồ được đọc đủ', async () => {
    const odoo = odooGia();
    const b = await baoCaoTongQuan({ odoo: odoo as never }, { ky: 'quy_nay', top_theo: 'so_don', chi_nhanh: 'TT', bayGio: BAY_GIO });
    const kwargs = odoo.execute.mock.calls[0][3] as Record<string, unknown>;
    expect(kwargs).toMatchObject({ time_preset: 'custom', warehouse_ids: [2], top_customer_by: 'orders', top_staff_by: 'orders' });
    expect(kwargs.top_product_by).toBeUndefined();
    expect(b.bieuDoDoanhThu).toHaveLength(2);
    expect(b.bieuDoChiNhanh.map((d) => d.ten)).toEqual(['TT', 'HCM']);
    expect(b.chiNhanh).toBe('TT');
    expect(b.topTheo).toBe('so_don');
  });
  it('hôm nay → cột theo GIỜ (chart_granularity=hour)', async () => {
    const odoo = odooGia();
    await baoCaoTongQuan({ odoo: odoo as never }, { ky: 'today' });
    expect(odoo.execute.mock.calls[0][3]).toMatchObject({ time_preset: 'today', chart_granularity: 'hour' });
  });
  it('mặc định → kwargs y như trước: chỉ time_preset this_month', async () => {
    const odoo = odooGia();
    await baoCaoTongQuan({ odoo: odoo as never }, {});
    expect(odoo.execute.mock.calls[0][3]).toEqual({ time_preset: 'this_month' });
  });
});

describe('baoCaoBanHang + bộ lọc web', () => {
  it('kỳ custom mà Odoo ném "cannot marshal None" (đo prod 25/08) → bảng rỗng + chỉ đường, KHÔNG crash', async () => {
    const odoo = { execute: vi.fn(async () => { throw new Error('cannot marshal None unless allow_none is enabled'); }) };
    const kq = await baoCaoBanHang({ odoo: odoo as never }, { ky: '6_thang_qua', bayGio: BAY_GIO });
    expect(kq.tabs).toEqual([]);
    expect(kq.ky).toContain('bao_cao_tong_quan');
  });
  it('preset thường mà Odoo lỗi → vẫn ném (không nuốt lỗi lạ)', async () => {
    const odoo = { execute: vi.fn(async () => { throw new Error('Odoo sập'); }) };
    await expect(baoCaoBanHang({ odoo: odoo as never }, { ky: 'this_month' })).rejects.toThrow('Odoo sập');
  });
  it('6 tháng qua + chi nhánh KB → custom đủ 2 ngày + warehouse_ids [4]', async () => {
    const odoo = odooGia();
    await baoCaoBanHang({ odoo: odoo as never }, { ky: '6_thang_qua', chi_nhanh: 'KB', tab: 'by_time', bayGio: BAY_GIO });
    expect(odoo.execute.mock.calls[0][3]).toEqual({
      time_preset: 'custom', date_from: '2026-03-01', date_to: '2026-08-26', warehouse_ids: [4],
    });
  });
});
