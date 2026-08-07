// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: hoá đơn TỰ ĐỘNG sau khi tạo đơn — không giao cho model quyết.
//
// Bug thật 06/08/2026 13:17: prompt dặn "tao_don_nhap → gui_hoa_don, gửi ngay
// không cần hỏi" nhưng model tạo S13801 xong THÔI LUÔN — không hình, không
// link. Nhân viên phải hỏi "sao không gửi hình đơn vào nhóm?". Việc luôn-phải-
// làm thì code làm (cùng nguyên tắc với ảnh SP luồng khách, 02/08).
import { describe, it, expect, vi } from 'vitest';
import { buildStaffRegistry } from '../../../src/modules/ai/agent/staff-agent.js';
import type { OdooClient } from '../../../src/modules/ai/odoo/client.js';
import type { HoaDonAnhClient } from '../../../src/modules/ai/odoo/hoa-don-anh.js';

const SP = { id: 1039, name: 'Nguồn NB 12V100W', list_price: 78_000, active: true };

/** Odoo giả đi trọn luồng taoDonNhap: chống trùng → SP → create → đọc lại. */
function odooGia() {
  let daTao = false;
  return {
    searchRead: vi.fn(async (model: string, domain: unknown) => {
      if (model === 'res.partner') return [{ id: 1441, name: 'Anh Dương Tuấn Anh' }];
      if (model === 'product.product') return [SP];
      const d = JSON.stringify(domain);
      if (model === 'sale.order' && daTao && d.includes('"id"')) {
        return [{ id: 26719, name: 'S13801', state: 'draft', amount_total: 780_000, partner_id: [1441, 'Anh Dương Tuấn Anh'] }];
      }
      return [];
    }),
    execute: vi.fn(async () => { daTao = true; return 26719; }),
  } as unknown as OdooClient;
}

const anhClientGia = () =>
  ({ render: vi.fn(async () => ({ duLieu: Buffer.from('png'), tenFile: 'S13801.png' })) }) as unknown as HoaDonAnhClient;

const taoDon = (r: ReturnType<typeof buildStaffRegistry>) =>
  r.executor()({
    id: 't1', name: 'tao_don_nhap',
    input: { khach_hang_id: 1441, dong: [{ san_pham_id: 1039, so_luong: 10 }] },
  });

describe('hoá đơn tự động sau tao_don_nhap', () => {
  it('tạo đơn xong → nhanHoaDon ĐƯỢC GỌI dù model không đụng gui_hoa_don', async () => {
    const nhanHoaDon = vi.fn();
    const r = buildStaffRegistry({
      odoo: odooGia(), conversationId: 'c1', seq: 0,
      ghiNhanChuyenSale: async () => {},
      anhClient: anhClientGia(), odooUrl: 'http://odoo', nhanHoaDon,
    });

    const kq = await taoDon(r);

    expect(kq.isError).toBeFalsy();
    expect(nhanHoaDon).toHaveBeenCalledTimes(1);
    expect(nhanHoaDon.mock.calls[0][0]).toMatchObject({ donId: 26719, maDon: 'S13801' });
  });

  it('câu trả về cho model nói theo vai NHÂN VIÊN — không còn "chờ sale xác nhận"', async () => {
    const r = buildStaffRegistry({
      odoo: odooGia(), conversationId: 'c1', seq: 0,
      ghiNhanChuyenSale: async () => {},
      anhClient: anhClientGia(), odooUrl: 'http://odoo', nhanHoaDon: vi.fn(),
    });

    const kq = await taoDon(r);

    // Người nghe CHÍNH LÀ sale — "chờ sale xác nhận" với họ là ngớ ngẩn.
    expect(kq.content).not.toContain('sale sẽ liên hệ');
    expect(kq.content).toContain('tự động');
  });

  it('render ảnh NÉM lỗi → đơn vẫn tạo thành công, không phá cả lượt', async () => {
    const anhLoi = { render: vi.fn(async () => { throw new Error('qweb sập'); }) } as unknown as HoaDonAnhClient;
    const nhanHoaDon = vi.fn();
    const r = buildStaffRegistry({
      odoo: odooGia(), conversationId: 'c1', seq: 0,
      ghiNhanChuyenSale: async () => {},
      anhClient: anhLoi, odooUrl: 'http://odoo', nhanHoaDon,
    });

    const kq = await taoDon(r);

    expect(kq.isError).toBeFalsy();
    expect(kq.content).toContain('S13801');
    // guiHoaDon nuốt lỗi render và vẫn trả link → hoá đơn (không ảnh) vẫn về.
    expect(nhanHoaDon).toHaveBeenCalledTimes(1);
    expect(nhanHoaDon.mock.calls[0][0]).toMatchObject({ anh: null });
  });

  it('KHÔNG có anhClient (playground) → tạo đơn vẫn chạy, không nổ', async () => {
    const r = buildStaffRegistry({
      odoo: odooGia(), conversationId: 'c1', seq: 0,
      ghiNhanChuyenSale: async () => {},
    });

    const kq = await taoDon(r);

    expect(kq.isError).toBeFalsy();
    expect(kq.content).toContain('S13801');
  });
});
