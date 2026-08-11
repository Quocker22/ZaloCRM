// SPDX-License-Identifier: AGPL-3.0-or-later
// VAT chạy HẾT ĐƯỜNG hay không — từ câu nhân viên tới lệnh ghi Odoo.
//
// VÌ SAO CÓ FILE NÀY (11/08/2026): đo prod 486 lượt gọi tool 04→11/08 thấy
// `tra-thue.ts` 0 lần chạy. Soi kỹ thì KHÔNG phải "tool không đăng ký ở registry
// nên model không gọi" — mà là ĐỨT DÂY THẬT: `trich-slot` trích được `vat`,
// `loi-nhan` biết hiện thuế, `tao-don-nhap`/`sua-don` biết ghi `tax_id`,
// `traThueBan()` tra được id — nhưng KHÔNG AI GỌI `traThueBan()`, và `dapSlot`
// không hề đọc `trich.vat`. Bốn mảnh rời nhau, tính năng VAT chưa từng chạy.
//
// Các test cũ (vat.test.ts, vat-don.func.ts) đều xanh vì chúng gán TAY
// `p.vatThueId = 4` hoặc gọi thẳng `taoDonNhap({thue_id: 4})` — không mảnh nào
// đi qua chỗ đứt. Bài học: test từng mảnh xanh hết mà tính năng vẫn chết.
//
// File này chạy ĐÚNG đường thật qua orchestrator `xuLyGomDon`.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import { xoaCacheThue } from '../../../../src/modules/ai/odoo/tools/tra-thue.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function fakeGenerate(slots: Record<string, unknown>[]): ToolAwareGenerate {
  let i = 0;
  return async () => {
    const input = slots[Math.min(i++, slots.length - 1)];
    return {
      text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't', name: 'ghi_slot', input }],
    };
  };
}

/**
 * Danh mục thuế THẬT đo trên prod LEDNELIA VN 11/08/2026:
 * id=3 "VAT 4%", id=4 "VAT 8%", id=5 "VAT 10%", id=6 "0%". KHÔNG có 5%.
 */
const THUE_PROD = [
  { id: 3, name: 'VAT 4%', amount: 4 },
  { id: 4, name: 'VAT 8%', amount: 8 },
  { id: 5, name: 'VAT 10%', amount: 10 },
  { id: 6, name: '0%', amount: 0 },
];

function fakeOdoo() {
  const CARD = {
    id: 448, name: 'Card thu BX-V7512 (cái)', default_code: 'SP000448',
    list_price: 230000, uom_id: [1, 'Cái'], active: true,
  };
  const odoo = {
    searchRead: vi.fn(async (model: string, domain: unknown[], fields?: unknown) => {
      const d = JSON.stringify(domain);
      if (model === 'account.tax') {
        // Lọc như thật: type_tax_use='sale' + amount khớp.
        const g = (domain as unknown[]).find(
          (x): x is [string, string, number] => Array.isArray(x) && x[0] === 'amount');
        return THUE_PROD.filter((t) => t.amount === Number(g?.[2]));
      }
      if (model === 'res.partner') {
        return [{ id: 3803, name: 'Anh Cảnh - Led Việt - Tam Kỳ', ref: 'KH003067', phone: false }];
      }
      if (model === 'product.product') {
        if (JSON.stringify(fields ?? []).includes('incokit_stock_breakdown')) {
          return [{ id: 448, name: CARD.name, incokit_stock_breakdown: [] }];
        }
        const g = (domain as unknown[]).find(
          (x): x is [string, string, number] => Array.isArray(x) && x[0] === 'list_price');
        if (g && g[1] === '<=') return [];
        return [CARD];
      }
      if (model === 'sale.order') return daTao ? [{ id: 500, name: 'S00500', state: 'draft', amount_total: 22852800 }] : [];
      return [];
    }),
    execute: vi.fn(async (_m: string, method: string) => {
      if (method === 'create') { daTao = true; return 500; }
      return true;
    }),
  };
  let daTao = false;
  return odoo;
}

function fakeDb() {
  const rows = new Map<string, { orgId: string; conversationId: string; slots: unknown; hetHan: Date }>();
  return {
    phienGomDon: {
      findUnique: async ({ where }: { where: { conversationId: string } }) => rows.get(where.conversationId) ?? null,
      upsert: async ({ where, create, update }: { where: { conversationId: string }; create: never; update: { slots: unknown; hetHan: Date } }) => {
        const cu = rows.get(where.conversationId);
        rows.set(where.conversationId, cu ? { ...cu, ...update } : create);
        return create;
      },
      deleteMany: async ({ where }: { where: { conversationId: string } }) => { rows.delete(where.conversationId); return { count: 1 }; },
    },
  };
}

function dungMay(slots: Record<string, unknown>[], hoiThoai = 'c-vat') {
  const odoo = fakeOdoo();
  const tinGui: string[] = [];
  const deps: GomDonDeps = {
    prisma: fakeDb() as never, odoo: odoo as never, generate: fakeGenerate(slots),
    anhClient: null, odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {}, ghiLog: () => {},
  };
  return {
    goi: (cau: string) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId: hoiThoai, seq: 1, cau, senderUid: 'uid-nv',
    }),
    tinGui, odoo,
  };
}

/** Dòng hàng trong lệnh create sale.order — nơi tax_id phải xuất hiện. */
function dongDaGhi(odoo: ReturnType<typeof fakeOdoo>): Array<Record<string, unknown>> {
  const call = odoo.execute.mock.calls.find((c) => c[1] === 'create');
  if (!call) return [];
  const vals = (call[2] as Array<Record<string, unknown>>)[0];
  return (vals.order_line as Array<[number, number, Record<string, unknown>]>).map((x) => x[2]);
}

beforeEach(() => { xoaCacheThue(); });

// ═══════════════════════════════════════════════════════════════════════════
describe('VAT nối hết đường: câu nhân viên → tax_id trong Odoo', () => {
  it('"có VAT" → tra account.tax THẬT rồi ghi tax_id vào dòng đơn', async () => {
    const may = dungMay([
      { khach: 'Cảnh Tam Kỳ', dong: [{ sp: 'card thu v7512', sl: 100, gia: 230000 }], vat: true },
      { chot: true },
    ]);

    await may.goi('lên đơn cho anh Cảnh Tam Kỳ 100 card thu v7512 giá 230k, có VAT');
    await may.goi('ok chốt');

    // 1. Phải TRA danh mục thuế — không hard-code id=4.
    const traThue = may.odoo.searchRead.mock.calls.filter((c) => c[0] === 'account.tax');
    expect(traThue.length).toBeGreaterThan(0);

    // 2. Phải GHI xuống dòng đơn bằng lệnh many2many của Odoo.
    expect(dongDaGhi(may.odoo)[0]!.tax_id).toEqual([[6, 0, [4]]]);
  });

  it('"VAT 10%" → tra đúng mức 10, ghi id=5 (KHÔNG lấy mặc định 8%)', async () => {
    const may = dungMay([
      { khach: 'Cảnh Tam Kỳ', dong: [{ sp: 'card thu v7512', sl: 10, gia: 230000 }], vat: 10 },
      { chot: true },
    ], 'c-vat-10');

    await may.goi('lên đơn 10 card thu v7512 giá 230k cho anh Cảnh, VAT 10%');
    await may.goi('ok');

    expect(dongDaGhi(may.odoo)[0]!.tax_id).toEqual([[6, 0, [5]]]);
  });

  it('tóm tắt CHO CHỐT hiện thuế + tổng sau thuế — NV thấy trước khi gật', async () => {
    const may = dungMay([
      { khach: 'Cảnh Tam Kỳ', dong: [{ sp: 'card thu v7512', sl: 100, gia: 230000 }], vat: true },
    ], 'c-vat-tomtat');

    await may.goi('lên đơn 100 card thu v7512 giá 230k cho anh Cảnh, xuất VAT');

    const tin = may.tinGui.join('\n');
    expect(tin).toContain('VAT 8%');
    // 100 × 230.000 = 23.000.000 → VAT 8% = 1.840.000 → tổng 24.840.000
    expect(tin).toContain('1.840.000');
    expect(tin).toContain('24.840.000');
  });

  it('KHÔNG nhắc VAT → không tra thuế, không ghi tax_id (đừng tự thêm thuế)', async () => {
    const may = dungMay([
      { khach: 'Cảnh Tam Kỳ', dong: [{ sp: 'card thu v7512', sl: 10, gia: 230000 }] },
      { chot: true },
    ], 'c-khong-vat');

    await may.goi('lên đơn 10 card thu v7512 giá 230k cho anh Cảnh');
    await may.goi('ok');

    expect(may.odoo.searchRead.mock.calls.filter((c) => c[0] === 'account.tax')).toHaveLength(0);
    expect(dongDaGhi(may.odoo)[0]).not.toHaveProperty('tax_id');
  });

  it('mức VAT Odoo KHÔNG có (5%) → BÁO RÕ, tuyệt đối không im lặng lên đơn không thuế', async () => {
    // Đây là ca sai sổ sách nguy hiểm nhất: NV tưởng đơn có VAT, hoá đơn ra
    // không có, phát hiện thì đã xuất mất rồi.
    const may = dungMay([
      { khach: 'Cảnh Tam Kỳ', dong: [{ sp: 'card thu v7512', sl: 10, gia: 230000 }], vat: 5 },
    ], 'c-vat-5');

    await may.goi('lên đơn 10 card thu v7512 giá 230k cho anh Cảnh, VAT 5%');

    const tin = may.tinGui.join('\n');
    expect(tin).toContain('5%');
    expect(tin.toLowerCase()).toMatch(/không (có|tìm)/);
  });
});
