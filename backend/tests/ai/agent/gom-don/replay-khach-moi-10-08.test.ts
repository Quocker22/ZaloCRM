// SPDX-License-Identifier: AGPL-3.0-or-later
// KỊCH BẢN THẬT nhóm 17:07-17:08 10/08/2026 — "khách mới" trống sau khi bot hỏi chọn.
//
//   [17:07:39] Quyết: @Tiểu Mã lên đơn cho anh chiến nhé, giá báo rồi
//   [17:07:44] Bot:   Có 10 khách tên "Chiến": 1) ... 10) ... chọn giúp em
//   [17:08:09] Quyết: khách mới
//
// HAI lỗi chồng nhau ở lượt cuối:
//   1. Câu "khách mới" KHÔNG tag bot → cổng batBuocTag vứt câu (test ở
//      tests/ai/agent/nhom-tag.func.ts). Sửa: phiên nhớ `hoiUid`.
//   2. Kể cả lọt cổng, "khách mới" TRỐNG không kèm tên → trích slot đòi
//      `khachMoi.ten` dài ≥2 nên bỏ qua, máy vẫn đứng ở bước hỏi chọn và lặp
//      lại y hệt câu hỏi 10 anh Chiến. Tên đã có sẵn trong phiên
//      (`khachTuKhoa` = "chiến") — máy phải tự lấy, không bắt nhân viên gõ lại.
//
// File này lo lỗi (2): từ chỗ bot đang hỏi chọn, "khách mới" phải chuyển sang
// tạo khách tên "chiến".
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/**
 * LLM giả bám sát hành vi thật đã quan sát: với câu "khách mới" trống, model
 * KHÔNG có tên để điền nên chỉ bật cờ, không trả `khachMoi.ten`.
 */
function fakeGenerate(): ToolAwareGenerate {
  return async (a) => {
    const nd = String(a.messages[0].content);
    const input = nd.includes('lên đơn cho anh chiến')
      ? { khach: 'chiến', dong: [{ sp: 'nguồn NB', sl: 10 }] }
      : nd.includes('khách mới')
        // Model chỉ thấy "khách mới" — bật cờ nhưng KHÔNG có tên để điền.
        ? { khachMoi: {} }
        : {};
    return {
      text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't1', name: 'ghi_slot', input }],
    };
  };
}

/** Odoo giả: tên "chiến" khớp 10 khách (đúng như prod), SP khớp duy nhất. */
function fakeOdoo() {
  const khach = Array.from({ length: 10 }, (_, i) => ({
    id: 100 + i, name: `Anh Chiến ${i + 1}`, ref: `KH00${3138 + i}`, phone: false,
  }));
  const sp = { id: 900, name: 'Nguồn NB 12V', default_code: 'NB12', list_price: 120000, uom_id: [1, 'Cái'] };

  const searchRead = vi.fn(async (model: string, domain: unknown[]) => {
    if (model === 'res.partner') return khach;
    if (model === 'product.product') {
      const giaTren = (domain as unknown[]).find(
        (d): d is [string, string, number] => Array.isArray(d) && d[0] === 'list_price');
      // traSanPham tra hai lượt (giá thật > 10, giá ảo <= 10) — tôn trọng để
      // không trả cùng một SP hai lần thành "2 ứng viên".
      if (giaTren && giaTren[1] === '<=') return [];
      return [sp];
    }
    return [];
  });
  return { searchRead, execute: vi.fn(async () => 1) };
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
      deleteMany: async ({ where }: { where: { conversationId: string } }) => {
        rows.delete(where.conversationId);
        return { count: 1 };
      },
    },
  };
}

function dungMay() {
  const odoo = fakeOdoo();
  const db = fakeDb();
  const tinGui: string[] = [];
  const deps: GomDonDeps = {
    prisma: db as never,
    odoo: odoo as never,
    generate: fakeGenerate(),
    anhClient: null,
    odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {},
    ghiLog: () => {},
  };
  const goi = (cau: string, senderUid = 'uid-quyet') =>
    xuLyGomDon(deps, { orgId: 'o1', conversationId: 'c1', seq: 1, cau, senderUid });
  return { goi, tinGui, odoo, db };
}

describe('replay 17:07-17:08 10/08 — "khách mới" trống giữa lúc bot hỏi chọn', () => {
  it('lượt 1: "lên đơn cho anh chiến" → bot liệt kê 10 khách để chọn', async () => {
    const { goi, tinGui } = dungMay();
    const nhan = await goi('lên đơn cho anh chiến nhé, giá báo rồi');
    expect(nhan).toBe(true);
    expect(tinGui.at(-1)).toMatch(/Chiến/i);
    expect(tinGui.at(-1)).toMatch(/chọn/i);
  });

  it('lượt 2: "khách mới" trống → tạo khách tên "chiến", KHÔNG hỏi lại 10 người', async () => {
    const { goi, tinGui, odoo } = dungMay();
    await goi('lên đơn cho anh chiến nhé, giá báo rồi');
    const soTinSauLuot1 = tinGui.length;

    await goi('khách mới');

    const traLoi = tinGui.slice(soTinSauLuot1).join('\n');
    // Lỗi cũ: lặp y hệt danh sách 10 anh Chiến.
    expect(traLoi).not.toMatch(/1\).*2\).*3\)/s);
    // Phải đi tới nhánh tạo khách: hoặc đã gọi create res.partner, hoặc hỏi
    // đúng thứ còn thiếu để tạo (SĐT/địa chỉ) — không quay lại bước chọn.
    const daTaoKhach = odoo.execute.mock.calls.some(
      (c) => String(c[0]) === 'res.partner' && String(c[1]) === 'create');
    expect(daTaoKhach || /sđt|số điện thoại|địa chỉ/i.test(traLoi)).toBe(true);
  });

  it('phiên ghi lại hoiUid — lượt sau nhận ra ai đang được hỏi', async () => {
    const { goi, db } = dungMay();
    await goi('lên đơn cho anh chiến nhé, giá báo rồi');
    const slots = db.rows.get('c1')?.slots as { hoiUid?: string } | undefined;
    expect(slots?.hoiUid).toBe('uid-quyet');
  });
});
