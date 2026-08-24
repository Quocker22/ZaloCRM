// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: sua_don — đổi SL / thêm dòng vào đơn nháp (bug S13804 07/08).
import { describe, it, expect, vi } from 'vitest';
import { suaDon, dinhDangSuaDon } from '../../../src/modules/ai/odoo/tools/sua-don.js';

/**
 * Odoo giả. donGoc = trạng thái + tổng đơn; dongHienCo = các dòng hiện có
 * (để test đổi SL đúng dòng theo product_id).
 */
function odooGia(opts: {
  state?: string;
  dongHienCo?: Array<{ id: number; product_id: [number, string] }>;
  tongTruoc?: number;
  tongSau?: number;
  khongCoDon?: boolean;
} = {}) {
  const goi: Array<{ model: string; method: string; args: unknown }> = [];
  return {
    goi,
    odoo: {
      searchRead: async (model: string, domain: unknown, fields?: unknown) => {
        const d = JSON.stringify(domain);
        if (model === 'sale.order' && d.includes('amount_total') && JSON.stringify(fields) === JSON.stringify(['amount_total'])) {
          return [{ amount_total: opts.tongSau ?? 7_800_000 }];
        }
        if (model === 'sale.order') {
          if (opts.khongCoDon) return [];
          return [{ id: 26722, name: 'S13804', state: opts.state ?? 'draft', amount_total: opts.tongTruoc ?? 780_000 }];
        }
        if (model === 'sale.order.line') return opts.dongHienCo ?? [];
        // Hàng rào chặn id bịa (24/08): suaDon kiểm mọi san_pham_id có thật.
        // Mock coi mọi id được hỏi là CÓ THẬT — các test này không nhắm vào
        // hàng rào đó (đã có test riêng trong phu-phi.func.ts).
        if (model === 'product.product') {
          const ids = (JSON.stringify(domain).match(/\d+/g) ?? []).map(Number);
          return ids.map((id) => ({ id }));
        }
        return [];
      },
      execute: vi.fn(async (model: string, method: string, args: unknown) => {
        goi.push({ model, method, args });
        return method === 'create' ? 5001 : true;
      }),
    },
  };
}

describe('suaDon — đổi số lượng', () => {
  it('SP đã có trong đơn → WRITE dòng đó (không tạo dòng mới)', async () => {
    const { odoo, goi } = odooGia({
      dongHienCo: [{ id: 700, product_id: [1039, 'Nguồn NB'] }],
    });
    const kq = await suaDon({ odoo }, { don_id: 26722, doi: [{ san_pham_id: 1039, so_luong: 100 }] });

    expect(kq.ok).toBe(true);
    expect(kq.soDoiSL).toBe(1);
    const write = goi.find((g) => g.method === 'write');
    expect(JSON.stringify(write?.args)).toContain('700');          // đúng line id
    expect(JSON.stringify(write?.args)).toContain('product_uom_qty');
    expect(JSON.stringify(write?.args)).toContain('100');
  });

  it('SP CHƯA có trong đơn → tạo dòng mới (đổi thành thêm)', async () => {
    const { odoo, goi } = odooGia({ dongHienCo: [] });
    const kq = await suaDon({ odoo }, { don_id: 26722, doi: [{ san_pham_id: 2000, so_luong: 5 }] });

    expect(kq.ok).toBe(true);
    expect(kq.soThem).toBe(1);
    expect(goi.some((g) => g.method === 'create')).toBe(true);
  });
});

describe('suaDon — thêm dòng hàng', () => {
  it('them → tạo dòng mới trên đúng đơn', async () => {
    const { odoo, goi } = odooGia({ dongHienCo: [{ id: 700, product_id: [1039, 'Nguồn NB'] }] });
    const kq = await suaDon({ odoo }, {
      don_id: 26722,
      them: [{ san_pham_id: 3000, so_luong: 100 }],
    });

    expect(kq.ok).toBe(true);
    expect(kq.soThem).toBe(1);
    const create = goi.find((g) => g.method === 'create');
    expect(JSON.stringify(create?.args)).toContain('26722');   // order_id
    expect(JSON.stringify(create?.args)).toContain('3000');    // product_id
  });

  it('đổi SL + thêm cùng lượt (ca S13804: 100 cái + thêm cáp)', async () => {
    const { odoo } = odooGia({ dongHienCo: [{ id: 700, product_id: [1039, 'Nguồn NB'] }] });
    const kq = await suaDon({ odoo }, {
      don_id: 26722,
      doi: [{ san_pham_id: 1039, so_luong: 100 }],
      them: [{ san_pham_id: 3000, so_luong: 100 }],
    });
    expect(kq.ok).toBe(true);
    expect(kq.soDoiSL).toBe(1);
    expect(kq.soThem).toBe(1);
  });
});

describe('suaDon — ranh giới', () => {
  it('đơn đã xác nhận (state=sale) → TỪ CHỐI', async () => {
    const { odoo } = odooGia({ state: 'sale' });
    const kq = await suaDon({ odoo }, { don_id: 26722, doi: [{ san_pham_id: 1039, so_luong: 100 }] });
    expect(kq.ok).toBe(false);
    expect(kq.lyDo).toContain('đã xác nhận');
  });

  it('không tìm thấy đơn → TỪ CHỐI', async () => {
    const { odoo } = odooGia({ khongCoDon: true });
    const kq = await suaDon({ odoo }, { don_id: 99999, doi: [{ san_pham_id: 1039, so_luong: 100 }] });
    expect(kq.ok).toBe(false);
    expect(kq.lyDo).toContain('Không tìm thấy');
  });

  it('không có gì để sửa → TỪ CHỐI', async () => {
    const { odoo } = odooGia();
    const kq = await suaDon({ odoo }, { don_id: 26722 });
    expect(kq.ok).toBe(false);
  });

  it('so_luong <= 0 → TỪ CHỐI, KHÔNG chạm Odoo write', async () => {
    const { odoo, goi } = odooGia();
    const kq = await suaDon({ odoo }, { don_id: 26722, doi: [{ san_pham_id: 1039, so_luong: 0 }] });
    expect(kq.ok).toBe(false);
    expect(goi.some((g) => g.method === 'write' || g.method === 'create')).toBe(false);
  });
});

describe('dinhDangSuaDon', () => {
  it('thành công → nêu tổng trước/sau, dặn gửi ảnh', () => {
    const s = dinhDangSuaDon({ ok: true, donId: 1, maDon: 'S13804', soDoiSL: 1, soThem: 1, tongTruoc: 780_000, tongSau: 7_800_000 });
    expect(s).toContain('S13804');
    expect(s).toContain('ảnh');
  });
  it('thất bại → KHÔNG nói đã sửa', () => {
    const s = dinhDangSuaDon({ ok: false, donId: 0, maDon: '', lyDo: 'đơn đã xác nhận' });
    expect(s).toContain('KHÔNG sửa được');
    expect(s).toContain('ĐỪNG nói đã sửa');
  });
});
