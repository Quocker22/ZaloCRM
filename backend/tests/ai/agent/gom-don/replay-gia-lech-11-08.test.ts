// SPDX-License-Identifier: AGPL-3.0-or-later
// REPLAY CA THẬT — nhóm Test-AI, 10:09:33 ngày 11/08/2026.
//
// Nhân viên nhắn "card thu triết khấu 8%". Model đọc "8%" rồi nhét số 8 vào ô
// ĐƠN GIÁ. Bot trả nguyên văn:
//
//   100 × Card thu BX-V7512 (cái) = 800đ (giá anh/chị báo 8đ, hệ thống 230.000đ)
//   Tổng: 800đ. Em chốt lên đơn nhé?
//
// tra_san_pham trả ĐÚNG 230.000đ/Cái ở cả 4 lần gọi (đã soi log) — số 8 là
// model bịa. Đơn 46 triệu tụt còn 800đ, và bot vẫn rủ chốt: chỉ cần nhân viên
// gõ "ok" là đơn sai nằm trong Odoo.
//
// Test này chạy ĐÚNG đường đi thật (qua orchestrator, không phải hàm thuần):
// câu lệch → bot hỏi lại → nhân viên "ok" → phải là gật cho GIÁ, không phải
// gật chốt đơn. Và đơn chỉ được ghi khi họ đã xác nhận.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
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

/** SP đúng như ca thật: Card thu BX-V7512, hệ thống để 230.000đ. */
function fakeOdoo() {
  const kh = [{ id: 3803, name: 'Anh Cảnh - Led Việt - Tam Kỳ', ref: 'KH003067ACDL', phone: false }];
  const CARD = {
    id: 448, name: 'Card thu BX-V7512 (cái)', default_code: 'SP000448',
    list_price: 230000, uom_id: [1, 'Cái'],
  };
  return {
    searchRead: vi.fn(async (model: string, domain: unknown[], fields?: unknown) => {
      const d = JSON.stringify(domain);
      if (model === 'res.partner') return kh;
      if (model === 'product.product') {
        if (JSON.stringify(fields ?? []).includes('incokit_stock_breakdown')) {
          return [{ id: 448, name: CARD.name, incokit_stock_breakdown: [] }];
        }
        const g = (domain as unknown[]).find(
          (x): x is [string, string, number] => Array.isArray(x) && x[0] === 'list_price');
        if (g && g[1] === '<=') return [];
        if (d.includes('"in"')) return [{ ...CARD, active: true }];
        return [CARD];
      }
      return [];
    }),
    execute: vi.fn(async () => 26742),
  };
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

function dungMay(slots: Record<string, unknown>[]) {
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
      orgId: 'o1', conversationId: 'c-gia-lech', seq: 1, cau, senderUid: 'uid-nv',
    }),
    tinGui, odoo,
  };
}

const taoDon = (odoo: ReturnType<typeof fakeOdoo>) =>
  odoo.execute.mock.calls.find((c) => String(c[0]) === 'sale.order' && String(c[1]) === 'create');

const dongDon = (odoo: ReturnType<typeof fakeOdoo>) => {
  const goi = taoDon(odoo) as [string, string, Array<Record<string, unknown>>] | undefined;
  const ol = goi?.[2][0].order_line as Array<[number, number, Record<string, unknown>]> | undefined;
  return (ol ?? []).map((x) => x[2]);
};

describe('CA THẬT 10:09:33 11/08 — giá 8đ vs hệ thống 230.000đ', () => {
  it('KHÔNG rủ chốt đơn 800đ; hỏi lại đúng hai con số', async () => {
    const { goi, tinGui, odoo } = dungMay([
      { lenDon: true, khach: 'cảnh tam kỳ', dong: [{ sp: 'card thu', sl: 100, gia: 8 }] },
    ]);
    await goi('lên đơn cho anh cảnh 100 card thu triết khấu 8%');

    const tin = tinGui.at(-1) ?? '';
    // Đây là hồi quy của chính câu bot đã nói hôm 11/08
    expect(tin).not.toContain('Em chốt lên đơn nhé?');
    expect(tin).not.toContain('800đ');
    expect(tin).toContain('8đ');
    expect(tin).toContain('230.000đ');
    expect(tin).toMatch(/xác nhận|đúng là bao nhiêu/i);
    // Chưa ai gật thì tuyệt đối không được ghi đơn
    expect(taoDon(odoo)).toBeUndefined();
  });

  it('nhân viên gõ "ok" ngay sau đó = gật cho GIÁ, chưa phải chốt đơn', async () => {
    const { goi, tinGui, odoo } = dungMay([
      { lenDon: true, khach: 'cảnh tam kỳ', dong: [{ sp: 'card thu', sl: 100, gia: 8 }] },
      { xacNhan: true },
    ]);
    await goi('lên đơn cho anh cảnh 100 card thu triết khấu 8%');
    await goi('ok');

    // Sau khi gật giá thì mới ra tóm tắt — và vẫn phải hỏi chốt một lần nữa,
    // nên "ok" đầu tiên KHÔNG thể tự nó đẩy đơn vào Odoo.
    expect(taoDon(odoo)).toBeUndefined();
    expect(tinGui.at(-1)).toContain('Em chốt lên đơn nhé?');
  });

  it('gật giá rồi chốt → đơn ghi ĐÚNG giá nhân viên báo (luật 10/08 giữ nguyên)', async () => {
    const { goi, odoo } = dungMay([
      { lenDon: true, khach: 'cảnh tam kỳ', dong: [{ sp: 'card thu', sl: 100, gia: 8 }] },
      { xacNhan: true },
      { xacNhan: true },
    ]);
    await goi('lên đơn cho anh cảnh 100 card thu triết khấu 8%');
    await goi('ok');      // gật cho giá 8đ
    await goi('chốt đi');  // gật chốt đơn

    // Nhân viên đã khẳng định hai lần → ghi theo họ, KHÔNG tự sửa số.
    expect(dongDon(odoo)[0]).toMatchObject({ product_id: 448, product_uom_qty: 100, price_unit: 8 });
  });

  it('nhân viên báo lại giá ĐÚNG (230k) → đơn ghi 230k, không hỏi nữa', async () => {
    const { goi, tinGui, odoo } = dungMay([
      { lenDon: true, khach: 'cảnh tam kỳ', dong: [{ sp: 'card thu', sl: 100, gia: 8 }] },
      { dong: [{ sp: 'card thu', gia: 230000 }] },
      { xacNhan: true },
    ]);
    await goi('lên đơn cho anh cảnh 100 card thu triết khấu 8%');
    await goi('230k nhé em');
    expect(tinGui.at(-1)).toContain('Em chốt lên đơn nhé?');
    await goi('ok');

    expect(dongDon(odoo)[0]).toMatchObject({ price_unit: 230000 });
  });
});

describe('KHÔNG chặn nhầm việc bán thật', () => {
  it('nhân viên giảm 20% (184k/230k) → tóm tắt thẳng, không hỏi giá lệch', async () => {
    const { goi, tinGui } = dungMay([
      { lenDon: true, khach: 'cảnh tam kỳ', dong: [{ sp: 'card thu', sl: 100, gia: 184000 }] },
    ]);
    await goi('lên đơn cho anh cảnh 100 card thu giá 184k');

    const tin = tinGui.at(-1) ?? '';
    expect(tin).toContain('Em chốt lên đơn nhé?');
    expect(tin).not.toMatch(/lệch nhiều quá/);
  });
});
