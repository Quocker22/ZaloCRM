// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: VAT trên CẢ HAI đường ghi đơn — tạo đơn và sửa đơn.
//
// Vì sao gộp một file: bài học đã trả giá 3 lần trong dự án này (giá 17:41
// 10/08, chiết khấu 11/08, tặng kèm 11/08) — vá đường TẠO mà quên đường SỬA.
// Test chung một file thì thiếu một đường là thấy ngay.
//
// Cơ chế: sale.order.line.tax_id (many2many → account.tax), ghi bằng lệnh
// [[6, 0, [id]]] của Odoo. KHÔNG tự nhân tay 8% rồi cộng vào giá — thuế là
// việc của Odoo, nó tự kế thừa xuống hoá đơn khi xuất (kiểm chứng prod:
// INV/2026/026158 ← S12869, untaxed 4.950.000 / tax 396.000 = đúng 8%).
import { describe, it, expect, vi } from 'vitest';
import { taoDonNhap } from '../../../src/modules/ai/odoo/tools/tao-don-nhap.js';
import { suaDon } from '../../../src/modules/ai/odoo/tools/sua-don.js';

const DON_DRAFT = {
  id: 500, name: 'S00500', state: 'draft',
  amount_total: 22852800, client_order_ref: 'zalo:conv-1:0',
};
const SP_OK = { id: 2, name: 'Card thu V7512', list_price: 230000, active: true };

function fakeOdooTao() {
  let daTao = false;
  return {
    searchRead: vi.fn(async (model: string, domain: unknown[]) => {
      const s = JSON.stringify(domain);
      if (model === 'res.partner') return [{ id: 1441, name: 'Anh Cảnh Tam Kỳ' }];
      if (model === 'product.product') return [SP_OK];
      if (s.includes('client_order_ref')) return [];
      if (s.includes('"id"')) return daTao ? [DON_DRAFT] : [];
      return [];
    }),
    execute: vi.fn(async (_m: string, method: string) => {
      if (method === 'create') { daTao = true; return 500; }
      return true;
    }),
  };
}

/** Vals dòng hàng trong lệnh create sale.order. */
function dongTao(odoo: ReturnType<typeof fakeOdooTao>): Array<Record<string, unknown>> {
  const call = odoo.execute.mock.calls.find((c) => c[1] === 'create');
  const vals = (call![2] as Array<Record<string, unknown>>)[0];
  return (vals.order_line as Array<[number, number, Record<string, unknown>]>).map((x) => x[2]);
}

const depsNv = (odoo: ReturnType<typeof fakeOdooTao>) =>
  ({ odoo, conversationId: 'conv-1', seq: 0, choPhepDatGia: true });

describe('TẠO ĐƠN — gắn VAT vào dòng hàng', () => {
  it('thue_id=4 → dòng có tax_id [[6,0,[4]]] (lệnh many2many "thay thế toàn bộ")', async () => {
    const odoo = fakeOdooTao();

    await taoDonNhap(depsNv(odoo), {
      khach_hang_id: 1441, ten_khach: 'Cảnh Tam Kỳ',
      dong: [{ san_pham_id: 2, so_luong: 100, don_gia: 230000, chiet_khau: 8 }],
      thue_id: 4,
    });

    expect(dongTao(odoo)[0].tax_id).toEqual([[6, 0, [4]]]);
  });

  it('KHÔNG nói VAT → KHÔNG có tax_id (giữ nguyên hành vi cũ, đừng tự thêm thuế)', async () => {
    const odoo = fakeOdooTao();

    await taoDonNhap(depsNv(odoo), {
      khach_hang_id: 1441, dong: [{ san_pham_id: 2, so_luong: 100, don_gia: 230000 }],
    });

    expect(dongTao(odoo)[0]).not.toHaveProperty('tax_id');
  });

  it('VAT áp cho MỌI dòng, kể cả dòng TẶNG (0đ × 8% = 0đ, nhưng hoá đơn phải nhất quán)', async () => {
    const odoo = fakeOdooTao();

    await taoDonNhap(depsNv(odoo), {
      khach_hang_id: 1441,
      dong: [
        { san_pham_id: 2, so_luong: 100, don_gia: 230000 },
        { san_pham_id: 2, so_luong: 1, tang: true },
      ],
      thue_id: 4,
    });

    for (const d of dongTao(odoo)) expect(d.tax_id).toEqual([[6, 0, [4]]]);
  });

  it('BẢO MẬT: luồng KHÁCH (không choPhepDatGia) KHÔNG được đặt thuế', async () => {
    // Khách điều khiển câu chữ thì điều khiển được thuế — cùng cổng với giá,
    // chiết khấu, tặng kèm và kho.
    const odoo = fakeOdooTao();

    await taoDonNhap(
      { odoo, conversationId: 'conv-1', seq: 0 },
      { khach_hang_id: 1441, dong: [{ san_pham_id: 2, so_luong: 1 }], thue_id: 4 },
    );

    expect(dongTao(odoo)[0]).not.toHaveProperty('tax_id');
  });

  it('BẢO MẬT: thue_id rác (0, âm, NaN, chuỗi) → bỏ qua, không ghi bừa', async () => {
    for (const rac of [0, -4, Number.NaN, '4; DROP' as unknown as number]) {
      const odoo = fakeOdooTao();
      await taoDonNhap(depsNv(odoo), {
        // Giá sát giá hệ thống (SP_OK 230.000đ): test này kiểm THUẾ, không
        // kiểm giá. Để 1.000đ thì hàng rào giá lệch bất thường (11/08) chặn
        // đơn trước khi tới phần thuế — đúng việc của nó, nhưng làm hỏng phép
        // đo ở đây.
        khach_hang_id: 1441, dong: [{ san_pham_id: 2, so_luong: 1, don_gia: 220000 }],
        thue_id: rac,
      });
      expect(dongTao(odoo)[0]).not.toHaveProperty('tax_id');
    }
  });
});

// ── ĐƯỜNG SỬA ĐƠN ────────────────────────────────────────────────────────
function fakeOdooSua(dongHienCo: Array<{ id: number; product_id: [number, string] }> = []) {
  return {
    searchRead: vi.fn(async (model: string) => {
      if (model === 'sale.order') return [{ id: 500, name: 'S00500', state: 'draft', amount_total: 22852800 }];
      if (model === 'sale.order.line') return dongHienCo;
      if (model === 'product.product') return [SP_OK];
      return [];
    }),
    execute: vi.fn(async () => 900),
  };
}

/** Vals của lệnh ghi (create/write) trên sale.order.line. */
function valsDongSua(odoo: ReturnType<typeof fakeOdooSua>, method: 'create' | 'write') {
  const call = odoo.execute.mock.calls.find((c) => c[0] === 'sale.order.line' && c[1] === method);
  const args = call![2] as unknown[];
  return (method === 'create' ? args[0] : args[1]) as Record<string, unknown>;
}

describe('SỬA ĐƠN — VAT phải chạy CẢ đường này (bài học 3 lần)', () => {
  it('thêm dòng mới có thue_id → tax_id [[6,0,[4]]]', async () => {
    const odoo = fakeOdooSua();

    await suaDon({ odoo }, {
      don_id: 500,
      them: [{ san_pham_id: 2, so_luong: 100, don_gia: 230000, thue_id: 4 }],
    });

    expect(valsDongSua(odoo, 'create').tax_id).toEqual([[6, 0, [4]]]);
  });

  it('đổi SL dòng ĐÃ CÓ kèm thue_id → write cũng gắn tax_id', async () => {
    // Nhân viên "đơn này xuất VAT nữa em" sau khi đơn đã lên: dòng cũ phải
    // được gắn thuế, không chỉ dòng thêm mới.
    const odoo = fakeOdooSua([{ id: 900, product_id: [2, 'Card thu V7512'] }]);

    await suaDon({ odoo }, {
      don_id: 500,
      doi: [{ san_pham_id: 2, so_luong: 100, thue_id: 4 }],
    });

    expect(valsDongSua(odoo, 'write').tax_id).toEqual([[6, 0, [4]]]);
  });

  it('KHÔNG truyền thue_id → KHÔNG đụng tax_id (giữ nguyên thuế đơn đang có)', async () => {
    const odoo = fakeOdooSua([{ id: 900, product_id: [2, 'Card thu V7512'] }]);

    await suaDon({ odoo }, { don_id: 500, doi: [{ san_pham_id: 2, so_luong: 50 }] });

    expect(valsDongSua(odoo, 'write')).not.toHaveProperty('tax_id');
  });

  it('thue_id rác → bỏ qua, không ghi bừa', async () => {
    const odoo = fakeOdooSua();
    await suaDon({ odoo }, {
      don_id: 500, them: [{ san_pham_id: 2, so_luong: 1, thue_id: -1 }],
    });
    expect(valsDongSua(odoo, 'create')).not.toHaveProperty('tax_id');
  });
});
