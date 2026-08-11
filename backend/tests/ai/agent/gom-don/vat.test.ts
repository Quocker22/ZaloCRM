// SPDX-License-Identifier: AGPL-3.0-or-later
// VAT trong máy gom đơn: trích slot → tóm tắt hiện thuế → ghi xuống Odoo.
//
// Anh Quốc chốt 11/08: "vat là sao trong odoo có tính năng vat mà? khách nói là
// thêm vat vào hóa đơn thì cứ thêm vào là được??" → dùng ĐÚNG cơ chế thuế của
// Odoo (account.tax + sale.order.line.tax_id), KHÔNG dựng sản phẩm giả "VAT".
//
// Cách này TỪNG CHẠY THẬT trên prod: 175 đơn + 143 hoá đơn dùng tax_id=4 trong
// 05-07/2026 (anh Nguyễn Thanh Cảnh tạo), dòng cuối 22/07/2026 đơn S12942.
import { describe, it, expect, vi } from 'vitest';
import { lamSachTrich } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/trich-slot.js';
import { renderLoiNhan } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/loi-nhan.js';
import type { PhienGom } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/kieu.js';

const phienCoBan = (): PhienGom => ({
  khachTuKhoa: 'Cảnh Tam Kỳ',
  khachDaChot: { id: 1441, ten: 'Anh Cảnh Tam Kỳ', ma: 'KH1441', dienThoai: '0905123456' },
  dong: [],
});

describe('trích slot VAT — ép input thô của model', () => {
  it('vat=true không kèm % → mặc định 8% (đo prod: 175/175 đơn VAT đều 8%)', () => {
    const kq = lamSachTrich({ vat: true });
    expect(kq.vat).toBe(8);
  });

  it('vat=10 → giữ 10 (nhân viên nói "VAT 10%")', () => {
    expect(lamSachTrich({ vat: 10 }).vat).toBe(10);
  });

  it('KHÔNG nhắc VAT → không có slot (đừng tự ý thêm thuế vào đơn)', () => {
    expect(lamSachTrich({ khach: 'Cảnh' }).vat).toBeUndefined();
  });

  it('model bịa % vô lý (150, -8, "tám") → BỎ, không ghi bừa vào đơn', () => {
    for (const rac of [150, -8, 'tám', 0]) {
      expect(lamSachTrich({ vat: rac }).vat).toBeUndefined();
    }
  });
});

describe('tóm tắt — nhân viên phải THẤY thuế và tổng SAU thuế trước khi chốt', () => {
  it('câu thật 11/08: 100 card giá 230k, CK 8%, có VAT 8%', () => {
    const p = phienCoBan();
    p.vatPhanTram = 8;
    p.vatThueId = 4;
    p.dong = [{
      tuKhoa: 'card nhận V7512', sl: 100, donGia: 230000, chietKhau: 8,
      daChot: { id: 2, ten: 'Card thu V7512', gia: 230000 },
    }];

    const tin = renderLoiNhan({ loai: 'tom_tat_don' }, p);

    // 100 × 230.000 = 23.000.000 → CK 8% → 21.160.000 → VAT 8% = 1.692.800
    // → tổng 22.852.800. Đúng con số anh Quốc đưa trong yêu cầu.
    expect(tin).toContain('21.160.000đ');
    expect(tin).toContain('VAT 8%');
    expect(tin).toContain('1.692.800đ');
    expect(tin).toContain('22.852.800đ');
  });

  it('KHÔNG có VAT → tóm tắt KHÔNG hiện dòng thuế (giữ nguyên tin cũ)', () => {
    const p = phienCoBan();
    p.dong = [{
      tuKhoa: 'card', sl: 100, donGia: 230000, chietKhau: 8,
      daChot: { id: 2, ten: 'Card thu V7512', gia: 230000 },
    }];

    const tin = renderLoiNhan({ loai: 'tom_tat_don' }, p);

    expect(tin).not.toContain('VAT');
    expect(tin).toContain('Tổng: 21.160.000đ');
  });

  it('NV nói VAT nhưng Odoo KHÔNG có mức đó → tóm tắt BÁO RÕ, không im lặng bỏ thuế', () => {
    // Đo prod: danh mục chỉ có 0/4/8/10%. "VAT 5%" là ca thật sẽ xảy ra.
    // Im lặng lên đơn không thuế = nhân viên tưởng có VAT = sai sổ sách.
    const p = phienCoBan();
    p.vatPhanTram = 5;
    p.vatKhongTra = true;
    p.dong = [{
      tuKhoa: 'card', sl: 10, donGia: 100000,
      daChot: { id: 2, ten: 'Card thu V7512', gia: 100000 },
    }];

    const tin = renderLoiNhan({ loai: 'tom_tat_don' }, p);

    expect(tin).toContain('5%');
    expect(tin.toLowerCase()).toMatch(/không (có|tìm)/);
  });
});

describe('BẢO MẬT — luồng KHÁCH không đặt được thuế', () => {
  it('tao_don_nhap KHÔNG có choPhepDatGia thì thue_id bị bỏ', async () => {
    // Đây là hàng rào thật: customer-agent.ts gọi taoDonNhap KHÔNG truyền
    // choPhepDatGia, nên dù model bị khách dụ điền thue_id cũng vô hiệu.
    const { taoDonNhap } = await import('../../../../src/modules/ai/odoo/tools/tao-don-nhap.js');
    let daTao = false;
    const odoo = {
      searchRead: vi.fn(async (model: string, domain: unknown[]) => {
        const s = JSON.stringify(domain);
        if (model === 'res.partner') return [{ id: 1441, name: 'Khach Le' }];
        if (model === 'product.product') return [{ id: 2, name: 'Card', list_price: 100000, active: true }];
        if (s.includes('client_order_ref')) return [];
        if (s.includes('"id"')) {
          return daTao ? [{ id: 7, name: 'S7', state: 'draft', amount_total: 100000 }] : [];
        }
        return [];
      }),
      execute: vi.fn(async (_m: string, method: string) => {
        if (method === 'create') { daTao = true; return 7; }
        return true;
      }),
    };

    await taoDonNhap(
      { odoo, conversationId: 'conv-khach', seq: 0 },
      { khach_hang_id: 1441, dong: [{ san_pham_id: 2, so_luong: 1 }], thue_id: 4 },
    );

    const vals = (odoo.execute.mock.calls.find((c) => c[1] === 'create')![2] as Array<Record<string, unknown>>)[0];
    const dong = (vals.order_line as Array<[number, number, Record<string, unknown>]>)[0][2];
    expect(dong).not.toHaveProperty('tax_id');
  });

  it('schema tool tao_don_nhap KHÔNG khai thue_id cho model tự điền', async () => {
    // Registry ép input thô: field đặc quyền không khai trong schema thì model
    // không có đường bịa. Máy gom đơn gọi hàm TRỰC TIẾP nên vẫn dùng được.
    const { taoDonNhapDefinition } = await import('../../../../src/modules/ai/odoo/tools/tao-don-nhap.js');
    const props = taoDonNhapDefinition.inputSchema.properties as Record<string, unknown>;
    const dongSchema = props.dong as { items?: { properties?: Record<string, unknown> } };
    expect(dongSchema.items?.properties).not.toHaveProperty('thue_id');
  });
});
