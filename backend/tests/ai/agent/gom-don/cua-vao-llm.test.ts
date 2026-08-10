// SPDX-License-Identifier: AGPL-3.0-or-later
// CỬA VÀO máy gom đơn do LLM quyết, KHÔNG do regex đoán chữ.
//
// Bug thật 22:09 10/08: "lên cho anh Huấn khách mới 10 nguồn NB nhé" — regex
// cũ đòi "lên"+"đơn" dính nhau nên trượt, máy không chạy, rơi xuống LLM tự do
// và mất luôn luật "giá NV báo thắng giá hệ thống" → bot hỏi vặn giá 170k.
//
// Anh Quốc 10/08: "sao lòng vòng thế nhỉ????, có mỗi việc lên đơn, nếu khách
// cũ thì lấy trong data còn khách mới thì sẽ nói là khách mới còn sản phẩm thì
// có thể sửa giá được, có thế thôi".
//
// Đúng. Vá regex từng chữ ("lên đơn", "lên cho", "bán cho"...) thì thiếu mãi.
// LLM giỏi hiểu câu chữ, code giỏi giữ luật — để mỗi bên làm việc của mình:
// LLM trả lời "đây có phải lệnh lên đơn không", code cầm lái phần còn lại.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** LLM giả: trả đúng những gì model thật trích được từ câu. */
function fakeGenerate(slot: Record<string, unknown>): ToolAwareGenerate {
  return async () => ({
    text: '', stopReason: 'tool_use', raw: null, usage,
    toolCalls: [{ id: 't1', name: 'ghi_slot', input: slot }],
  });
}

function fakeOdoo() {
  const khach = [{ id: 1, name: 'Anh Huấn A', ref: 'KH001', phone: false }];
  const sp = { id: 9, name: 'Nguồn NB 12V300W', default_code: 'NB300', list_price: 126000, uom_id: [1, 'Cái'] };
  return {
    searchRead: vi.fn(async (model: string, domain: unknown[]) => {
      if (model === 'res.partner') return khach;
      if (model === 'product.product') {
        const g = (domain as unknown[]).find(
          (d): d is [string, string, number] => Array.isArray(d) && d[0] === 'list_price');
        if (g && g[1] === '<=') return [];
        return [sp];
      }
      return [];
    }),
    execute: vi.fn(async () => 1),
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

function dungMay(slot: Record<string, unknown>) {
  const odoo = fakeOdoo();
  const db = fakeDb();
  const tinGui: string[] = [];
  const deps: GomDonDeps = {
    prisma: db as never, odoo: odoo as never, generate: fakeGenerate(slot),
    anhClient: null, odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {}, ghiLog: () => {},
  };
  return {
    goi: (cau: string) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId: 'c1', seq: 1, cau, senderUid: 'uid-quyet',
    }),
    tinGui, odoo, db,
  };
}

describe('máy NHẬN việc khi LLM nói đây là lệnh lên đơn', () => {
  it('ca thật 22:09 — "lên cho anh Huấn..." KHÔNG có chữ "đơn"', async () => {
    // Model trích đúng: có khách, có hàng, có số lượng → lenDon=true.
    const { goi } = dungMay({
      lenDon: true, khachMoi: { ten: 'Huấn' }, dong: [{ sp: 'nguồn NB', sl: 10 }],
    });
    // Máy PHẢI nhận việc (true), không nhường cho LLM tự do.
    expect(await goi('lên cho anh Huấn khách mới 10 nguồn NB nhé')).toBe(true);
  });

  it('"bán cho chị Lan 5 cuộn led" — động từ khác, vẫn nhận', async () => {
    const { goi } = dungMay({ lenDon: true, khach: 'Lan', dong: [{ sp: 'cuộn led', sl: 5 }] });
    expect(await goi('bán cho chị Lan 5 cuộn led')).toBe(true);
  });

  it('cách nói cũ "lên đơn cho..." vẫn chạy, không hồi quy', async () => {
    const { goi } = dungMay({ lenDon: true, khach: 'Huấn', dong: [{ sp: 'nguồn NB', sl: 10 }] });
    expect(await goi('lên đơn cho anh Huấn 10 nguồn NB')).toBe(true);
  });
});

describe('máy NHƯỜNG khi không phải việc của nó', () => {
  it('LLM nói ngoại lệ → nhường agent thường', async () => {
    const { goi, tinGui } = dungMay({ ngoaiLe: true });
    expect(await goi('doanh số tháng này bao nhiêu')).toBe(false);
    expect(tinGui).toHaveLength(0);
  });

  it('không có cờ lenDon và không có phiên → nhường', async () => {
    const { goi } = dungMay({ khach: 'Vấn' });
    expect(await goi('công nợ anh Vấn thế nào')).toBe(false);
  });

  it('xuất HOÁ ĐƠN không phải lên đơn — LLM phân biệt được', async () => {
    const { goi } = dungMay({ ngoaiLe: true });
    expect(await goi('xuất hóa đơn cho anh Thức')).toBe(false);
  });
});

describe('GIÁ nhân viên báo thắng giá hệ thống (luật 10/08)', () => {
  it('"NB 12V300W giá 170k" → dùng 170k, KHÔNG hỏi vặn giá (ca thật 22:11)', async () => {
    const { goi, tinGui } = dungMay({
      lenDon: true, khach: 'Huấn',
      dong: [{ sp: 'NB 12V300W', sl: 10, gia: 170000 }],
    });
    await goi('Trần Xuân Huấn - 0905049584, NB 12V300W giá 170k nhé');

    const tra = tinGui.join('\n');
    // Lỗi cũ (agent LLM tự do): "hệ thống chỉ có giá 126.000đ... anh xác nhận
    // giá 126k đúng không?" — bắt nhân viên giải trình giá của chính họ.
    expect(tra).not.toMatch(/xác nhận giá 126|chỉ có giá 126/i);
    // Đúng: lấy giá NV báo, tính tiền theo giá đó, nêu rõ chênh lệch cho minh bạch.
    expect(tra).toContain('1.700.000');
    expect(tra).toMatch(/giá anh\/chị báo/i);
    // Vẫn hỏi chốt trước khi ghi Odoo — đó là bước cố ý, không phải hỏi vặn.
    expect(tra).toMatch(/chốt/i);
  });

  it('sau khi nhân viên chốt → ghi Odoo với giá 170k', async () => {
    const odoo = fakeOdoo();
    const db = fakeDb();
    const tinGui: string[] = [];
    // Lượt 1 trích slot có giá; lượt 2 là câu xác nhận.
    let lan = 0;
    const generate: ToolAwareGenerate = async () => {
      lan++;
      const input = lan === 1
        ? { lenDon: true, khach: 'Huấn', dong: [{ sp: 'NB 12V300W', sl: 10, gia: 170000 }] }
        : { xacNhan: true };
      return { text: '', stopReason: 'tool_use', raw: null, usage,
        toolCalls: [{ id: 't', name: 'ghi_slot', input }] };
    };
    const deps: GomDonDeps = {
      prisma: db as never, odoo: odoo as never, generate,
      anhClient: null, odooUrl: 'https://odoo.example.com',
      guiTin: async (t) => { tinGui.push(t); },
      guiAnhHoaDon: async () => {}, ghiLog: () => {},
    };
    const goi = (cau: string) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId: 'c2', seq: 1, cau, senderUid: 'uid-quyet',
    });

    await goi('Trần Xuân Huấn - 0905049584, NB 12V300W giá 170k nhé');
    await goi('ok em');

    // Giá NV báo phải tới được Odoo, không bị giá hệ thống 126k đè.
    const json = JSON.stringify(odoo.execute.mock.calls);
    expect(json).toContain('170000');
    expect(json).not.toContain('126000');
  });
});
