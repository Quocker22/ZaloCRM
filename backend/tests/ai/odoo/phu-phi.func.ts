// SPDX-License-Identifier: AGPL-3.0-or-later
// PHỤ PHÍ (24/08) — ca thật 23:08: "lên đơn cho anh Vấn 1 cái nguồn NB, thêmm
// 70k ship" → S15179 ra 78.000đ, 70k ship bị vứt. Anh Quyết: "cứ thêm một
// hàng nữa là tiền ship ở cuối, linh động, một tiền khác cũng thêm một hàng".
import { describe, it, expect, vi } from 'vitest';
import { lamSachPhuPhi, laPhiShip, timSanPhamPhi, lenhDongPhuPhi } from '../../../src/modules/ai/odoo/tools/phu-phi.js';
import { taoDonNhap } from '../../../src/modules/ai/odoo/tools/tao-don-nhap.js';
import { suaDon } from '../../../src/modules/ai/odoo/tools/sua-don.js';

describe('lamSachPhuPhi', () => {
  it('nhận mảng sạch, làm tròn tiền', () => {
    expect(lamSachPhuPhi([{ ten: 'Phí vận chuyển', tien: 70000.4 }]))
      .toEqual([{ ten: 'Phí vận chuyển', tien: 70000 }]);
  });
  it('bỏ dòng rác: tiền ≤ 0, tên rỗng, vượt trần 1 tỷ, không phải mảng', () => {
    expect(lamSachPhuPhi([
      { ten: 'x', tien: 0 }, { ten: '', tien: 5000 }, { ten: 'Phí', tien: 2_000_000_000 },
    ])).toEqual([]);
    expect(lamSachPhuPhi('70k')).toEqual([]);
    expect(lamSachPhuPhi(undefined)).toEqual([]);
  });
});

describe('laPhiShip', () => {
  it('ship/vận chuyển/cước (cả không dấu) → true; phí lắp đặt → false', () => {
    expect(laPhiShip('Phí vận chuyển')).toBe(true);
    expect(laPhiShip('70k ship')).toBe(true);
    expect(laPhiShip('cuoc xe')).toBe(true);
    expect(laPhiShip('Phí lắp đặt')).toBe(false);
  });
});

const SP_PHI = [{ id: 632, name: 'Phí vận chuyển' }];

describe('timSanPhamPhi', () => {
  it('tra đúng tên trước, có thì dùng', async () => {
    const searchRead = vi.fn(async () => SP_PHI);
    const sp = await timSanPhamPhi({ searchRead } as never, 'Phí vận chuyển');
    expect(sp).toEqual({ id: 632, ten: 'Phí vận chuyển' });
  });
  it('phí lạ không có SP riêng → rơi về SP "phí vận chuyển" (tên thật ghi ở dòng)', async () => {
    const searchRead = vi.fn(async (_m: string, domain: unknown[][]) =>
      String(domain[0][2]).includes('lắp đặt') ? [] : SP_PHI);
    const sp = await timSanPhamPhi({ searchRead } as never, 'Phí lắp đặt');
    expect(sp?.id).toBe(632);
  });
  it('Odoo không có SP phí nào → null', async () => {
    const searchRead = vi.fn(async () => []);
    expect(await timSanPhamPhi({ searchRead } as never, 'Phí vận chuyển')).toBeNull();
  });
});

describe('lenhDongPhuPhi', () => {
  it('dòng SL 1, giá = tiền phí, TÊN DÒNG = tên phí thật', () => {
    expect(lenhDongPhuPhi({ id: 632, ten: 'Phí vận chuyển' }, { ten: 'Phí lắp đặt', tien: 200000 }))
      .toEqual([0, 0, { product_id: 632, product_uom_qty: 1, name: 'Phí lắp đặt', price_unit: 200000 }]);
  });
});

// ─── taoDonNhap với phu_phi — ca thật 23:08 tái dựng ────────────────────────
const odooTaoDon = () => {
  const donTao: Record<string, unknown>[] = [];
  const odoo = {
    searchRead: vi.fn(async (model: string, domain: unknown[][]) => {
      const d = JSON.stringify(domain);
      if (model === 'res.partner') return [{ id: 27, name: 'Anh Vấn Đà Nẵng 0934.786.998' }];
      // Query theo TÊN (ilike) → SP phí; theo ID → trả đúng các id được hỏi
      // (taoDonNhap kiểm mọi san_pham_id có thật).
      if (model === 'product.product') {
        if (d.includes('ilike')) return SP_PHI;
        const ids = (d.match(/\d+/g) ?? []).map(Number).filter((n) => n > 100);
        return ids.map((id) => ({ id, name: `SP ${id}`, list_price: 78000 }));
      }
      // Idempotency: tra theo client_order_ref phải RỖNG (chưa có đơn) —
      // trả bừa một đơn là taoDonNhap tưởng 'da_ton_tai'.
      if (model === 'sale.order' && d.includes('client_order_ref')) return [];
      if (model === 'sale.order') {
        return [{ id: 9001, name: 'S15179', state: 'draft', amount_total: 148000, client_order_ref: 'x' }];
      }
      return [];
    }),
    execute: vi.fn(async (model: string, method: string, args: unknown[]) => {
      if (model === 'sale.order' && method === 'create') { donTao.push(args[0] as Record<string, unknown>); return 9001; }
      return 1;
    }),
  };
  return { odoo, donTao };
};

describe('taoDonNhap + phu_phi', () => {
  it('"1 nguồn NB + 70k ship" → 2 dòng: hàng + Phí vận chuyển 70k ở cuối', async () => {
    const { odoo, donTao } = odooTaoDon();
    const kq = await taoDonNhap(
      { odoo: odoo as never, conversationId: 'c1', seq: 1, choPhepDatGia: true },
      {
        khach_hang_id: 27, ten_khach: 'Vấn',
        dong: [{ san_pham_id: 409, so_luong: 1, don_gia: 78000 }],
        phu_phi: [{ ten: 'Phí vận chuyển', tien: 70000 }],
      },
    );
    expect(kq.trangThai).toBe('da_tao');
    const lines = donTao[0].order_line as Array<[number, number, Record<string, unknown>]>;
    expect(lines).toHaveLength(2);
    expect(lines[1][2]).toMatchObject({ product_uom_qty: 1, name: 'Phí vận chuyển', price_unit: 70000 });
  });

  it('luồng KHÁCH (không choPhepDatGia) → phu_phi bị BỎ, không cho khách tự đặt phí', async () => {
    const { odoo, donTao } = odooTaoDon();
    const kq = await taoDonNhap(
      { odoo: odoo as never, conversationId: 'c2', seq: 2 },
      {
        khach_hang_id: 27, ten_khach: 'Vấn',
        dong: [{ san_pham_id: 409, so_luong: 1 }],
        phu_phi: [{ ten: 'Phí vận chuyển', tien: 1 }],
      },
    );
    expect(kq.trangThai).toBe('da_tao');
    expect(donTao[0].order_line as unknown[]).toHaveLength(1);
  });
});

// ─── suaDon: chặn id bịa + thêm phụ phí — ca thật 20:59 ────────────────────
const odooSuaDon = (spThat: number[]) => ({
  searchRead: vi.fn(async (model: string) => {
    if (model === 'sale.order') return [{ id: 28031, name: 'S15113', state: 'draft', amount_total: 1250000 }];
    if (model === 'sale.order.line') return [];
    if (model === 'product.product') {
      return spThat.map((id) => ({ id, name: id === 632 ? 'Phí vận chuyển' : `SP ${id}` }));
    }
    return [];
  }),
  execute: vi.fn(async () => 1),
});

describe('suaDon — chặn id bịa (ca 20:59: model bịa id 123 = Led 3 bóng Hồng)', () => {
  it('san_pham_id không tồn tại → TỪ CHỐI, chỉ đường tra_san_pham + phu_phi', async () => {
    const odoo = odooSuaDon([]); // Odoo không có SP nào trong các id gửi lên
    const kq = await suaDon({ odoo: odoo as never }, {
      ma_don: 'S15113', doi: [{ san_pham_id: 123, so_luong: 10 }],
    });
    expect(kq.ok).toBe(false);
    expect(kq.lyDo).toMatch(/không tồn tại|KHÔNG tồn tại/i);
    expect(odoo.execute).not.toHaveBeenCalled();
  });
});

describe('suaDon + phu_phi ("thêm vận chuyển 70k nữa")', () => {
  it('chỉ phu_phi, không doi/them → vẫn sửa được, tạo dòng phí đúng số', async () => {
    const odoo = odooSuaDon([632]);
    const kq = await suaDon({ odoo: odoo as never }, {
      ma_don: 'S15113', phu_phi: [{ ten: 'Phí vận chuyển', tien: 70000 }],
    });
    expect(kq.ok).toBe(true);
    const goiTao = odoo.execute.mock.calls.find((c) => c[0] === 'sale.order.line' && c[1] === 'create');
    expect(goiTao?.[2]?.[0]).toMatchObject({
      product_id: 632, product_uom_qty: 1, name: 'Phí vận chuyển', price_unit: 70000,
    });
  });
});
