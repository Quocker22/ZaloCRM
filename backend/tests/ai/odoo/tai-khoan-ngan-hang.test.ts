// SPDX-License-Identifier: AGPL-3.0-or-later
// 17/08/2026 — TK nhận tiền VietQR đọc từ Odoo (res.partner.bank công ty),
// không còn env AI_QR_*. Odoo không lưu BIN → map tên/bic → BIN NAPAS ở code.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { binTuTenNganHang, taiKhoanNhanTien, xoaCacheTaiKhoan } from '../../../src/modules/ai/odoo/tai-khoan-ngan-hang.js';

describe('binTuTenNganHang — tên/bic Odoo → BIN NAPAS', () => {
  it('3 ngân hàng thật trên Odoo prod (đo 17/08) ra đúng BIN', () => {
    expect(binTuTenNganHang('Ngân hàng TMCP Tiên Phong', 'TPBank')).toBe('970423');
    expect(binTuTenNganHang('Ngân hàng Nông nghiệp và Phát triển Nông thôn Việt Nam', 'Agribank')).toBe('970405');
    expect(binTuTenNganHang('Ngân hàng TMCP Ngoại thương Việt Nam', 'Vietcombank')).toBe('970436');
  });
  it('không biết → null, KHÔNG đoán bừa', () => {
    expect(binTuTenNganHang('Ngân hàng Lạ Hoắc', 'XYZ')).toBeNull();
  });
});

describe('taiKhoanNhanTien — dòng đầu danh sách còn active + tra được BIN', () => {
  beforeEach(() => xoaCacheTaiKhoan());
  const odoo = (banks: Array<Record<string, unknown>>, bic: Record<number, string>) => ({
    searchRead: vi.fn(async (model: string, domain: unknown[]) => {
      if (model === 'res.company') return [{ id: 1, partner_id: [1, 'LEDNELIA'] }];
      if (model === 'res.partner.bank') return banks;
      if (model === 'res.bank') { const id = Number((domain as [string, string, number][])[0][2]); return [{ bic: bic[id] ?? '' }]; }
      return [];
    }),
  });

  it('lấy TK đầu tiên tra được BIN; TK ngân hàng lạ bị bỏ qua', async () => {
    const o = odoo([
      { id: 9, acc_number: '111', acc_holder_name: 'A', bank_id: [99, 'Ngân hàng Lạ'], sequence: 1 },
      { id: 1, acc_number: '655 226 86868', acc_holder_name: 'Pham Tu Anh', bank_id: [2, 'Ngân hàng TMCP Tiên Phong - TPBank'], sequence: 2 },
    ], { 2: 'TPBank', 99: 'XYZ' });
    const tk = await taiKhoanNhanTien(o as never);
    expect(tk).toEqual({ bankBin: '970423', accountNo: '65522686868', accountName: 'Pham Tu Anh', tenNganHang: 'Ngân hàng TMCP Tiên Phong - TPBank' });
  });

  it('công ty không có TK → null (bot bỏ qua QR, không sinh QR sai)', async () => {
    expect(await taiKhoanNhanTien(odoo([], {}) as never)).toBeNull();
  });

  it('cache 5 phút: lần 2 không hỏi Odoo lại', async () => {
    const o = odoo([{ id: 1, acc_number: '1', bank_id: [2, 'TPBank'], sequence: 1 }], { 2: 'TPBank' });
    await taiKhoanNhanTien(o as never);
    const n = o.searchRead.mock.calls.length;
    await taiKhoanNhanTien(o as never);
    expect(o.searchRead.mock.calls.length).toBe(n);
  });
});
