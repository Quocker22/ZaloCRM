// SPDX-License-Identifier: AGPL-3.0-or-later
// 17/08 22:27 — NV xin QR/STK, bot bảo "không có" dù Odoo có 5 TK. Tool mới.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { traNganHang, dinhDangTraNganHang } from '../../../src/modules/ai/odoo/tools/tra-ngan-hang.js';
import { xoaCacheTaiKhoan } from '../../../src/modules/ai/odoo/tai-khoan-ngan-hang.js';

const odooCo5Tk = () => ({
  searchRead: vi.fn(async (model: string, domain: unknown[]) => {
    if (model === 'res.company') return [{ id: 1, partner_id: [1, 'LEDNELIA'] }];
    if (model === 'res.partner.bank') return [
      { id: 1, acc_number: '65522686868', acc_holder_name: 'Pham Tu Anh', bank_id: [2, 'Ngân hàng TMCP Tiên Phong - TPBank'], sequence: 1 },
      { id: 2, acc_number: '1500333345555', acc_holder_name: 'Cty Nelia', bank_id: [3, 'Agribank'], sequence: 2 },
    ];
    if (model === 'res.bank') { const id = Number((domain as [string, string, number][])[0][2]); return [{ bic: id === 2 ? 'TPBank' : 'Agribank' }]; }
    return [];
  }),
});

describe('tra_ngan_hang', () => {
  beforeEach(() => xoaCacheTaiKhoan());
  it('liệt kê TK từ Odoo + sinh ảnh QR cho TK mặc định (không cần số tiền)', async () => {
    const kq = await traNganHang({ odoo: odooCo5Tk() as never }, {});
    expect(kq.danhSach).toHaveLength(2);
    expect(kq.danhSach[0]).toMatchObject({ stk: '65522686868', macDinh: true, coQr: true });
    expect(kq.qr?.duLieu.length).toBeGreaterThan(500);
    const text = dinhDangTraNganHang(kq);
    expect(text).toContain('65522686868');
    expect(text).toContain('ĐÃ GỬI ẢNH QR');
    expect(text).not.toMatch(/không có thông tin/i);
  });
  it('kèm số tiền → QR điền sẵn + text nói rõ số tiền', async () => {
    const kq = await traNganHang({ odoo: odooCo5Tk() as never }, { so_tien: 350000 });
    expect(kq.qr?.soTien).toBe(350000);
    expect(dinhDangTraNganHang(kq)).toContain('350.000đ');
  });
  it('Odoo không có TK → nói thật + chỉ đường thêm trên Odoo', async () => {
    const odoo = { searchRead: vi.fn(async (m: string) => (m === 'res.company' ? [{ id: 1, partner_id: [1, 'X'] }] : [])) };
    const kq = await traNganHang({ odoo: odoo as never }, {});
    expect(kq.qr).toBeUndefined();
    expect(dinhDangTraNganHang(kq)).toContain('CHƯA khai báo');
  });
});
