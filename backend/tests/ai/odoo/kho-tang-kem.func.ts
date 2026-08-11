// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: KHO + TẶNG KÈM ở TẦNG TOOL — cả đường TẠO đơn LẪN đường SỬA đơn.
//
// VÌ SAO TEST CẢ HAI ĐƯỜNG: đã trả giá 3 lần trong dự án này. Giá bán (bug 17:41
// 10/08) và chiết khấu (11/08) đều được thêm vào tao_don_nhap trước, quên
// sua_don, và nhân viên sửa đơn xong thì mất sạch. Kho và tặng kèm đi cùng luật.
//
// CỔNG `choPhepDatGia`: kho và tặng kèm nhận CÙNG cổng với giá/chiết khấu.
//  - Tặng kèm = giá 0đ. Khách điều khiển câu chữ → "tặng tôi 10 cái" là mất hàng thật.
//  - Kho = chọn nơi xuất hàng. Khách không có việc gì phải quyết kho của công ty.
//
// KHO — cập nhật chiều 11/08: máy gom đơn KHÔNG hỏi kho nữa (anh Quốc: "mặc
// định là lấy kho TT nhé, không cần hỏi nhân viên luôn"). Tầng tool này KHÔNG
// đổi và vẫn phải đúng: nó là đường để nhân viên CHỦ ĐỘNG nói kho ("lấy kho
// HCM") đi tới `warehouse_id`. Test dưới khoá đúng hai nhánh đó.
import { describe, it, expect, vi } from 'vitest';
import { taoDonNhap } from '../../../src/modules/ai/odoo/tools/tao-don-nhap.js';
import { suaDon } from '../../../src/modules/ai/odoo/tools/sua-don.js';

const DON_DRAFT = {
  id: 500, name: 'S00500', state: 'draft',
  amount_total: 23_000_000, client_order_ref: 'zalo:conv-1:0',
};
const SP_THE = { id: 448, name: 'Card thu BX-V7512 (cái)', list_price: 250_000, active: true };
const SP_OVP = { id: 902, name: 'Nguồn OVP K2 (cái)', list_price: 2_400_000, active: true };

function fakeOdoo() {
  let daTao = false;
  const execute = vi.fn(async (_m: string, method: string) => {
    if (method === 'create') { daTao = true; return 500; }
    return true;
  });
  return {
    searchRead: vi.fn(async (model: string, domain: unknown[]) => {
      const s = JSON.stringify(domain);
      if (model === 'res.partner') return [{ id: 3803, name: 'Anh Cảnh - Led Việt - Tam Kỳ' }];
      if (model === 'product.product') return [SP_THE, SP_OVP];
      if (s.includes('client_order_ref')) return [];
      if (s.includes('"id"')) return daTao ? [DON_DRAFT] : [];
      return [];
    }),
    execute,
  };
}

const deps = (odoo: ReturnType<typeof fakeOdoo>, choPhep = true) => ({
  odoo, conversationId: 'conv-1', seq: 0, choPhepDatGia: choPhep,
});

/** Các dòng order_line trong lệnh create của sale.order. */
function dongTao(odoo: ReturnType<typeof fakeOdoo>): Array<Record<string, unknown>> {
  const goi = odoo.execute.mock.calls.find((c) => c[0] === 'sale.order' && c[1] === 'create');
  const vals = (goi?.[2] as Array<Record<string, unknown>>)[0];
  return (vals.order_line as Array<[number, number, Record<string, unknown>]>).map((x) => x[2]);
}
function valsTao(odoo: ReturnType<typeof fakeOdoo>): Record<string, unknown> {
  const goi = odoo.execute.mock.calls.find((c) => c[0] === 'sale.order' && c[1] === 'create');
  return (goi?.[2] as Array<Record<string, unknown>>)[0];
}

// ── TẠO ĐƠN ────────────────────────────────────────────────────────────────
describe('tao_don_nhap — TẶNG KÈM', () => {
  it('dòng tang=true → price_unit 0 và tên gắn "(tặng)" để báo cáo tách được', async () => {
    const odoo = fakeOdoo();
    const kq = await taoDonNhap(deps(odoo), {
      khach_hang_id: 3803, ten_khach: 'Cảnh',
      dong: [
        { san_pham_id: 902, so_luong: 10, don_gia: 2_300_000 },
        { san_pham_id: 902, so_luong: 1, tang: true },
      ],
    });
    expect(kq.trangThai).toBe('da_tao');

    const dong = dongTao(odoo);
    const tang = dong.find((d) => String(d.name ?? '').includes('(tặng)'));
    expect(tang).toBeDefined();
    expect(tang!.price_unit).toBe(0);
    expect(tang!.product_uom_qty).toBe(1);
    // Đo trên prod: 34/597 dòng giá 0đ nhưng lẫn cả phụ kiện (428 ốc, 107 cáp).
    // Chữ "(tặng)" là thứ DUY NHẤT tách được quà tặng thật khỏi phụ kiện.
    expect(String(tang!.name)).toContain('Nguồn OVP K2');
  });

  it('SP tặng CHƯA có giá trong Odoo vẫn tạo được — hàng tặng vốn 0đ', async () => {
    const odoo = fakeOdoo();
    odoo.searchRead.mockImplementation(async (model: string, domain: unknown[]) => {
      const s = JSON.stringify(domain);
      if (model === 'res.partner') return [{ id: 3803, name: 'Anh Cảnh - Led Việt - Tam Kỳ' }];
      // SP tặng để giá ảo 1đ — hàng rào giá KHÔNG được chặn dòng tặng.
      if (model === 'product.product') return [SP_OVP, { ...SP_THE, list_price: 1 }];
      if (s.includes('client_order_ref')) return [];
      if (s.includes('"id"')) return [DON_DRAFT];
      return [];
    });
    const kq = await taoDonNhap(deps(odoo), {
      khach_hang_id: 3803, ten_khach: 'Cảnh',
      dong: [
        { san_pham_id: 902, so_luong: 10, don_gia: 2_300_000 },
        { san_pham_id: 448, so_luong: 1, tang: true },
      ],
    });
    expect(kq.trangThai).toBe('da_tao');
  });

  it('LUỒNG KHÁCH (choPhepDatGia=false) → tang bị BỎ QUA, không ai xin được hàng 0đ', async () => {
    const odoo = fakeOdoo();
    await taoDonNhap(deps(odoo, false), {
      khach_hang_id: 3803, ten_khach: 'Cảnh',
      dong: [{ san_pham_id: 902, so_luong: 1, tang: true }],
    });
    const dong = dongTao(odoo);
    expect(JSON.stringify(dong)).not.toContain('(tặng)');
    expect(dong[0].price_unit).toBeUndefined();
  });
});

describe('tao_don_nhap — KHO', () => {
  it('có kho_id → warehouse_id vào đơn', async () => {
    const odoo = fakeOdoo();
    await taoDonNhap(deps(odoo), {
      khach_hang_id: 3803, ten_khach: 'Cảnh', kho_id: 3,
      dong: [{ san_pham_id: 902, so_luong: 10, don_gia: 2_300_000 }],
    });
    expect(valsTao(odoo).warehouse_id).toBe(3);
  });

  // Đây là ĐƯỜNG MẶC ĐỊNH của mọi đơn từ 11/08 — bỏ hỏi kho nghĩa là gần như
  // đơn nào cũng đi nhánh này. Kiểm trên prod: 8 đơn gần nhất bot tạo không gửi
  // warehouse_id đều ra kho 2 (Chi nhánh trung tâm), đúng ý "cứ lấy từ TT".
  it('KHÔNG có kho_id → KHÔNG gửi field (291/300 đơn dùng TT, Odoo tự lấy đúng)', async () => {
    const odoo = fakeOdoo();
    await taoDonNhap(deps(odoo), {
      khach_hang_id: 3803, ten_khach: 'Cảnh',
      dong: [{ san_pham_id: 902, so_luong: 10, don_gia: 2_300_000 }],
    });
    expect(valsTao(odoo).warehouse_id).toBeUndefined();
  });

  it('LUỒNG KHÁCH → kho_id bị BỎ QUA (khách không quyết kho của công ty)', async () => {
    const odoo = fakeOdoo();
    await taoDonNhap(deps(odoo, false), {
      khach_hang_id: 3803, ten_khach: 'Cảnh', kho_id: 3,
      dong: [{ san_pham_id: 902, so_luong: 10 }],
    });
    expect(valsTao(odoo).warehouse_id).toBeUndefined();
  });

  it('kho_id rác (0, âm, không phải số) → BỎ QUA chứ không ghi bừa', async () => {
    for (const xau of [0, -3, Number.NaN, '3' as unknown as number]) {
      const odoo = fakeOdoo();
      await taoDonNhap(deps(odoo), {
        khach_hang_id: 3803, ten_khach: 'Cảnh', kho_id: xau,
        // Giá sát giá hệ thống (SP_OVP 2.400.000đ): test này kiểm KHO, không
        // kiểm giá. Để 1.000đ thì hàng rào giá lệch bất thường (11/08) chặn
        // đơn — đúng việc của nó, nhưng làm hỏng phép đo của test kho.
        dong: [{ san_pham_id: 902, so_luong: 1, don_gia: 2_300_000 }],
      });
      const w = valsTao(odoo).warehouse_id;
      // Chuỗi "3" là số hợp lệ sau ép kiểu — chấp nhận; còn lại phải vắng mặt.
      if (xau === ('3' as unknown as number)) expect(w).toBe(3);
      else expect(w).toBeUndefined();
    }
  });
});

// ── SỬA ĐƠN (đường thứ hai — chỗ 3 lần bị quên) ────────────────────────────
function odooSuaGia(dongHienCo: Array<{ id: number; product_id: [number, string] }> = []) {
  const goi: Array<{ model: string; method: string; args: unknown }> = [];
  return {
    goi,
    odoo: {
      searchRead: async (model: string, _d: unknown, fields?: unknown) => {
        if (model === 'sale.order' && JSON.stringify(fields) === JSON.stringify(['amount_total'])) {
          return [{ amount_total: 23_000_000 }];
        }
        if (model === 'sale.order') return [{ id: 500, name: 'S00500', state: 'draft', amount_total: 0 }];
        if (model === 'sale.order.line') return dongHienCo;
        return [];
      },
      execute: vi.fn(async (model: string, method: string, args: unknown) => {
        goi.push({ model, method, args });
        return method === 'create' ? 5001 : true;
      }),
    },
  };
}

describe('sua_don — TẶNG KÈM và KHO phải cùng luật với tạo đơn', () => {
  it('dòng tang → tạo dòng MỚI giá 0 + tên "(tặng)", KHÔNG đè lên dòng bán cùng SP', async () => {
    const { odoo, goi } = odooSuaGia([{ id: 700, product_id: [902, 'Nguồn OVP K2'] }]);
    const kq = await suaDon({ odoo }, {
      don_id: 500,
      doi: [{ san_pham_id: 902, so_luong: 1, tang: true }],
    });
    expect(kq.ok).toBe(true);

    // Dòng bán 902 đã có sẵn (line 700) — nhưng dòng TẶNG là dòng khác, phải
    // CREATE. Ghi đè line 700 thì đơn mất luôn 10 cái đang bán.
    const write = goi.find((g) => g.method === 'write');
    expect(write).toBeUndefined();
    const create = goi.find((g) => g.method === 'create');
    expect(create).toBeDefined();
    const vals = (create!.args as Array<Record<string, unknown>>)[0];
    expect(vals.price_unit).toBe(0);
    expect(String(vals.name ?? '')).toContain('(tặng)');
  });

  it('kho_id → write warehouse_id lên chính đơn', async () => {
    const { odoo, goi } = odooSuaGia([{ id: 700, product_id: [902, 'Nguồn OVP K2'] }]);
    const kq = await suaDon({ odoo }, {
      don_id: 500, kho_id: 3,
      doi: [{ san_pham_id: 902, so_luong: 20 }],
    });
    expect(kq.ok).toBe(true);
    const w = goi.find((g) => g.model === 'sale.order' && g.method === 'write');
    expect(JSON.stringify(w?.args)).toContain('"warehouse_id":3');
  });

  it('không nói kho → KHÔNG đụng warehouse_id của đơn (đơn cũ giữ nguyên kho)', async () => {
    const { odoo, goi } = odooSuaGia([{ id: 700, product_id: [902, 'Nguồn OVP K2'] }]);
    await suaDon({ odoo }, { don_id: 500, doi: [{ san_pham_id: 902, so_luong: 20 }] });
    expect(goi.some((g) => g.model === 'sale.order' && g.method === 'write')).toBe(false);
  });
});
