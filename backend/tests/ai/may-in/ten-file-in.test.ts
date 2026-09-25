// SPDX-License-Identifier: AGPL-3.0-or-later
// Tên file in hoá đơn (chủ chốt 24/09): AI-INV_2026_030045-<Ten_Khach_khong_dau>-<jobId>.pdf
import { describe, it, expect } from 'vitest';
import {
  boDau,
  doanAnToan,
  taoTenFileIn,
  tenFileDayDu,
  modelCuaReport,
  TEN_KHACH_KHONG_RO,
  TEN_KHACH_TOI_DA,
} from '../../../src/modules/ai/may-in/ten-file-in.js';

describe('boDau', () => {
  it('bỏ mọi dấu tiếng Việt, kể cả đ/Đ (NFD không tách được)', () => {
    expect(boDau('Anh Lộc Beco Thanh Hoá')).toBe('Anh Loc Beco Thanh Hoa');
    expect(boDau('Đặng Đức Được')).toBe('Dang Duc Duoc');
    expect(boDau('Chị Muội HCM')).toBe('Chi Muoi HCM');
    expect(boDau('ưỡng ỵ ộ ẫ')).toBe('uong y o a');
  });
});

describe('doanAnToan', () => {
  it('khoảng trắng / ký tự lạ → một "_", bỏ "_" hai đầu, KHÔNG giữ "-"', () => {
    expect(doanAnToan('  Anh Lộc - Beco, Thanh Hoá (VIP) ')).toBe('Anh_Loc_Beco_Thanh_Hoa_VIP');
    expect(doanAnToan('INV/2026/030045')).toBe('INV_2026_030045');
  });
  it('cắt theo trần, không để "_" treo ở cuối', () => {
    const dai = 'Nguyen Van A '.repeat(20);
    const kq = doanAnToan(dai, TEN_KHACH_TOI_DA);
    expect(kq.length).toBeLessThanOrEqual(TEN_KHACH_TOI_DA);
    expect(kq.endsWith('_')).toBe(false);
  });
  it('chuỗi toàn ký tự lạ → rỗng', () => {
    expect(doanAnToan(' / - , ')).toBe('');
  });
});

describe('taoTenFileIn + tenFileDayDu', () => {
  it('đúng mẫu chủ giao: AI-INV_2026_030045-<Ten_Khach>-<jobId>.pdf', () => {
    const goc = taoTenFileIn({ soHoaDon: 'INV/2026/030045', tenKhach: 'Anh Lộc Beco Thanh Hoá' });
    expect(goc).toBe('AI-INV_2026_030045-Anh_Loc_Beco_Thanh_Hoa');
    const jobId = 'tokAbc-1727170000000-3';
    expect(tenFileDayDu(goc, jobId)).toBe('AI-INV_2026_030045-Anh_Loc_Beco_Thanh_Hoa-tokAbc-1727170000000-3.pdf');
  });
  it('không đọc được tên khách → "Khong_ro", vẫn đủ 4 phần', () => {
    expect(taoTenFileIn({ soHoaDon: 'INV/2026/030045', tenKhach: null })).toBe(`AI-INV_2026_030045-${TEN_KHACH_KHONG_RO}`);
    expect(taoTenFileIn({ soHoaDon: 'INV/2026/030045', tenKhach: '  ' })).toBe(`AI-INV_2026_030045-${TEN_KHACH_KHONG_RO}`);
  });
  it('tên file đủ luôn CHỨA jobId (app nhận ra job trong hàng đợi Windows theo jobId)', () => {
    const jobId = 'x_1-2-3';
    expect(tenFileDayDu(taoTenFileIn({ soHoaDon: 'S15883', tenKhach: 'Chị Muội' }), jobId)).toContain(jobId);
  });
});

describe('modelCuaReport', () => {
  it('suy model từ mẫu in', () => {
    expect(modelCuaReport('incokit_pos.report_invoice_document_kiotviet')).toBe('account.move');
    expect(modelCuaReport('incokit_pos.report_saleorder_kiotviet')).toBe('sale.order');
    expect(modelCuaReport('purchase.report_purchaseorder')).toBe('purchase.order');
    expect(modelCuaReport('mau_la.report_gi_do')).toBeNull();
  });
});
