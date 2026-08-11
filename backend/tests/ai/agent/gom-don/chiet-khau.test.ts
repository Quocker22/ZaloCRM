// SPDX-License-Identifier: AGPL-3.0-or-later
// CHIẾT KHẤU ngay khi lên đơn — không bắt nhân viên nhắc thêm một lượt.
//
// Ca thật 03:23-03:26 11/08 (nhóm):
//   03:23:18  "lên đơn cho anh cảnh tam kỳ 100 cái card nhận V7512. giá 230k
//              triết khấu 8%"     ← ĐÃ nói chiết khấu ngay từ đầu
//   03:24:35  bot: "100 × Card thu BX-V7512 = 23.000.000đ"   ← BỎ QUA chiết khấu
//   03:24:53  "triết khấu 8% nữa em"   ← nhân viên phải nhắc LẠI
//   03:26:16  bot mới sửa thành 21.160.000đ
// Anh Quốc: "rồi cái lên đơn chưa lên thêm được chiết khấu nữa".
//
// Kiểm chứng trên Odoo: đơn S13825 cuối cùng ĐÚNG (discount=8%, 21.160.000đ) —
// nhưng mất một lượt thừa vì máy gom đơn không có ô chiết khấu, phải chờ tool
// sua_chiet_khau chạy ở lượt sau.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function fakeGenerate(slots: Record<string, unknown>[]): ToolAwareGenerate {
  let i = 0;
  return async () => {
    const input = slots[Math.min(i++, slots.length - 1)];
    return { text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't', name: 'ghi_slot', input }] };
  };
}

function fakeOdoo() {
  const kh = [{ id: 3803, name: 'Anh Cảnh - Led Việt - Tam Kỳ', ref: 'KH003067ACDL', phone: false }];
  const sp = { id: 448, name: 'Card thu BX-V7512 (cái)', default_code: 'SP000448', list_price: 250000, uom_id: [1, 'Cái'] };
  return {
    searchRead: vi.fn(async (model: string, domain: unknown[]) => {
      if (model === 'res.partner') return kh;
      if (model === 'product.product') {
        const g = (domain as unknown[]).find(
          (d): d is [string, string, number] => Array.isArray(d) && d[0] === 'list_price');
        if (g && g[1] === '<=') return [];
        return [sp];
      }
      return [];
    }),
    execute: vi.fn(async () => 26742),
  };
}

function fakeDb() {
  const rows = new Map<string, { orgId: string; conversationId: string; slots: unknown; hetHan: Date }>();
  return {
    rows,
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
  const db = fakeDb();
  const tinGui: string[] = [];
  const deps: GomDonDeps = {
    prisma: db as never, odoo: odoo as never, generate: fakeGenerate(slots),
    anhClient: null, odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {}, ghiLog: () => {},
  };
  return {
    goi: (cau: string) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId: 'c-ck', seq: 1, cau, senderUid: 'uid-nv',
    }),
    tinGui, odoo, db,
  };
}

describe('chiết khấu nói ngay lúc lên đơn (ca thật 03:23 11/08)', () => {
  const SLOT = {
    lenDon: true, khach: 'cảnh tam kỳ',
    dong: [{ sp: 'card nhận V7512', sl: 100, gia: 230000, chietKhau: 8 }],
  };

  it('tin tóm tắt nêu rõ chiết khấu và tính ĐÚNG tiền sau giảm', async () => {
    const { goi, tinGui } = dungMay([SLOT]);
    await goi('lên đơn cho anh cảnh tam kỳ 100 cái card nhận V7512. giá 230k triết khấu 8%');
    const tra = tinGui.join('\n');
    // 100 × 230.000 × 0,92 = 21.160.000 (KHÔNG phải 23.000.000)
    expect(tra).toContain('21.160.000');
    expect(tra).not.toContain('23.000.000');
    expect(tra).toMatch(/chiết khấu|CK/i);
  });

  it('sau khi chốt → discount vào thẳng Odoo, KHÔNG cần lượt sửa thứ hai', async () => {
    const { goi, odoo } = dungMay([SLOT, { xacNhan: true }]);
    await goi('lên đơn cho anh cảnh tam kỳ 100 cái card nhận V7512. giá 230k triết khấu 8%');
    await goi('ok em');

    const taoDon = odoo.execute.mock.calls.find(
      (c) => String(c[0]) === 'sale.order' && String(c[1]) === 'create');
    expect(taoDon).toBeDefined();
    const json = JSON.stringify(taoDon);
    expect(json).toContain('"discount":8');
    expect(json).toContain('230000');
  });

  it('KHÔNG có chiết khấu → không gửi field discount (hành vi cũ nguyên vẹn)', async () => {
    const { goi, odoo } = dungMay([
      { lenDon: true, khach: 'cảnh tam kỳ', dong: [{ sp: 'card nhận V7512', sl: 100, gia: 230000 }] },
      { xacNhan: true },
    ]);
    await goi('lên đơn cho anh cảnh 100 card V7512 giá 230k');
    await goi('ok');
    const taoDon = odoo.execute.mock.calls.find(
      (c) => String(c[0]) === 'sale.order' && String(c[1]) === 'create');
    expect(JSON.stringify(taoDon)).not.toContain('discount');
  });

  it('chiết khấu vô lý (>100 hoặc âm) → BỎ QUA, không ghi bừa vào đơn', async () => {
    const { goi, odoo } = dungMay([
      { lenDon: true, khach: 'cảnh tam kỳ', dong: [{ sp: 'card nhận V7512', sl: 100, gia: 230000, chietKhau: 150 }] },
      { xacNhan: true },
    ]);
    await goi('lên đơn 100 card V7512 giá 230k chiết khấu 150%');
    await goi('ok');
    const taoDon = odoo.execute.mock.calls.find(
      (c) => String(c[0]) === 'sale.order' && String(c[1]) === 'create');
    expect(JSON.stringify(taoDon)).not.toContain('discount');
  });
});
