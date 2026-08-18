// SPDX-License-Identifier: AGPL-3.0-or-later
// REPLAY CA THẬT — nhóm bán hàng, 11:51-12:00 ngày 18/08/2026.
// Anh Quốc gửi transcript kèm đúng ba chữ: "cái gì thế này?".
//
//   11:51:52  Ánh  : "lên đơn a tuấn qc thăng long 13 cuộn led zz thấu kính giá 80k 1 cuộn"
//   11:51:59  Bot  : '"led zz thấu kính" có 3 loại: a) Led F30 24V Màu Ấm ATX Đầu Đục …'
//   11:52:21  Ánh  : "thấu kính 12v-30d"                → "Em vẫn chưa khớp được…"
//   11:52:48  Ánh  : "ziczac thấu kính 11000k đó"       → in LẠI đúng 3 SP F30 cũ
//   11:54:02  Ánh  : "led dây ziczac thấu kính 12v-30d" → "Em vẫn chưa khớp được…"
//   11:54:44  Ánh  : "ko chuẩn rồi"
//   11:55:09  Quyết: "sai mã hàng rồi"
//   12:00:05  Quốc : "ziczac thấu kính nhé"             → "Em vẫn chưa khớp được…"
//
// HÀNG CÓ THẬT: "Led dây ziczac thấu kính 12V-30D màu Trắng 11000K" — 75.000đ,
// id 2013/2014/2017 trên Odoo prod (đo 18/08). Bot vẫn nhốt nhân viên 9 phút.
//
// HAI LỖI RIÊNG BIỆT, test này khoá cả hai:
//
//  1. TRA SAI NGAY TỪ ĐẦU. "zz" là cách shop gõ tắt của "ziczac" — viết tắt bỏ
//     nguyên âm, thứ `ilike` (khớp chuỗi con LIỀN MẠCH) không bao giờ với tới,
//     vì "zz" KHÔNG nằm trong "ziczac". Mọi tầng trượt → nhánh nới-OR vơ về 16
//     SP chỉ khớp chữ rời "thau"/"kinh" ("… ATX Đầu Đục"). Sửa: suy ra viết tắt
//     từ TỪ VỰNG THẬT của catalog (tra-san-pham.ts), không khai bảng tay —
//     anh Quốc 18/08: "sao lại bảng alias???? tôi tưởng AI nó phải biết chứ".
//
//  2. KHÔNG CÓ ĐƯỜNG RA khi tra sai. Khi danh sách a/b/c đang treo, mọi tầng
//     của chon.ts chỉ so trong `dong.ungVien` — tức so với đúng 3 SP SAI; còn
//     đường tra cứu thì bỏ qua dòng đã có `ungVien`. Nhân viên gõ ĐÚNG NGUYÊN
//     TÊN hàng cũng không thoát được: máy tự nhốt mình trong tập ứng viên sai.
//     Sửa: NV gõ lại tên hàng → TRA LẠI catalog, thay ứng viên (gom-don/index).
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function fakeGenerate(slots: Record<string, unknown>[]): ToolAwareGenerate {
  let i = 0;
  return async () => ({
    text: '', stopReason: 'tool_use', raw: null, usage,
    toolCalls: [{ id: 't', name: 'ghi_slot', input: slots[Math.min(i++, slots.length - 1)] }],
  });
}

/** Bốn SP đúng như prod: 3 hàng ziczac thật + đám F30 từng chiếm chỗ của chúng. */
const KHO = [
  { id: 2013, name: 'Led dây ziczac thấu kính 12V-30D màu Trắng 11000K', default_code: false, list_price: 75000, uom_id: [1, 'Cuộn'] },
  { id: 2017, name: 'Led dây ziczac thấu kính 12V-30D màu Trung tính 4500K', default_code: false, list_price: 75000, uom_id: [1, 'Cuộn'] },
  { id: 2014, name: 'Led dây zichzac thấu kính 12V-30D màu Vàng Nắng 3000K', default_code: false, list_price: 75000, uom_id: [1, 'Cuộn'] },
  { id: 886, name: 'Led F30 24V Màu Ấm ATX Đầu Đục (bóng)', default_code: 'F30ATX24V - WW - DD', list_price: 4300, uom_id: [2, 'Bóng'] },
  { id: 881, name: 'Led F30 24V Màu Trắng ATX Đầu Trong (bóng)', default_code: 'F30ATX24V W', list_price: 3500, uom_id: [2, 'Bóng'] },
  { id: 887, name: 'Led F30 24V Màu Trắng ATX Đầu Đục (bóng)', default_code: 'F30ATX24V W - DD', list_price: 4500, uom_id: [2, 'Bóng'] },
];

const bo = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

/** Odoo giả hiểu ilike + prefix-notation ('&' / '|') như server thật. */
function fakeOdoo() {
  const khop = (d: unknown, r: Record<string, unknown>): boolean => {
    const [f, op, v] = d as [string, string, unknown];
    if (f === 'list_price') {
      const g = Number(r.list_price ?? 0);
      return op === '>' ? g > Number(v) : g <= Number(v);
    }
    if (f === 'id') return Number(r.id) === Number(v);
    if (f === 'name' || f === 'default_code') {
      const mau = bo(String(v)).replace(/[.*+?^${}()[\]\\]/g, '\\$&')
        .replace(/_/g, '.').replace(/%/g, '.*');
      return new RegExp(mau, 'i').test(bo(String(r[f] ?? '')));
    }
    return true;
  };
  const danhGia = (dom: unknown[], r: Record<string, unknown>): boolean => {
    let i = 0;
    const doc = (): ((x: Record<string, unknown>) => boolean) => {
      const t = dom[i]; i += 1;
      if (t === '&') { const a = doc(), b = doc(); return (x) => a(x) && b(x); }
      if (t === '|') { const a = doc(), b = doc(); return (x) => a(x) || b(x); }
      return (x) => khop(t, x);
    };
    const ves: Array<(x: Record<string, unknown>) => boolean> = [];
    while (i < dom.length) ves.push(doc());
    return ves.every((f) => f(r));
  };
  return {
    searchRead: vi.fn(async (
      model: string, domain: unknown[], fields?: unknown, opts: { limit?: number } = {},
    ) => {
      if (model === 'res.partner') {
        return [{ id: 77, name: 'Anh Tuấn QC Thăng Long', ref: 'KH000077', phone: false }];
      }
      if (model === 'product.product') {
        if (JSON.stringify(fields ?? []).includes('incokit_stock_breakdown')) return [];
        const r = KHO.filter((x) => danhGia(domain, x));
        return opts.limit === undefined ? r : r.slice(0, opts.limit);
      }
      return [];
    }),
    execute: vi.fn(async () => 90001),
  };
}

function fakeDb() {
  const rows = new Map<string, unknown>();
  return {
    phienGomDon: {
      findUnique: async ({ where }: { where: { conversationId: string } }) =>
        rows.get(where.conversationId) ?? null,
      upsert: async ({ where, create, update }: {
        where: { conversationId: string }; create: never; update: Record<string, unknown>;
      }) => {
        const cu = rows.get(where.conversationId) as Record<string, unknown> | undefined;
        rows.set(where.conversationId, cu ? { ...cu, ...update } : create);
        return create;
      },
      deleteMany: async ({ where }: { where: { conversationId: string } }) => {
        rows.delete(where.conversationId); return { count: 1 };
      },
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
    goi: (cau: string, seq: number) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId: 'c-ziczac-18-08', seq, cau, senderUid: 'uid-nv',
    }),
    tinGui,
  };
}

const LENH = {
  lenDon: true, khach: 'a tuấn qc thăng long',
  dong: [{ sp: 'led zz thấu kính', sl: 13, gia: 80000 }],
};

describe('CA THẬT 11:51-12:00 18/08 — "led zz thấu kính" nhốt NV 9 phút', () => {
  it('lượt ĐẦU TIÊN đã ra đúng hàng ziczac, không còn Led F30', async () => {
    const { goi, tinGui } = dungMay([LENH]);
    await goi('lên đơn a tuấn qc thăng long 13 cuộn led zz thấu kính giá 80k 1 cuộn', 3001);
    const tin = tinGui.join('\n');
    // Đây là thứ nhân viên đã nhận hôm 11:51:59 và chê "ko chuẩn rồi".
    expect(tin).not.toMatch(/F30/i);
    expect(tin).toMatch(/zic[hz]?zac/i);
  });

  it('NV gõ lại ĐÚNG TÊN hàng khi danh sách đang treo → thoát ra được', async () => {
    // Dựng đúng thế bí của ca thật: ép lượt đầu treo danh sách SAI (từ khoá
    // "thấu kính" một mình khớp cả F30 lẫn ziczac), rồi NV gõ tên đầy đủ.
    const { goi, tinGui } = dungMay([
      { lenDon: true, khach: 'a tuấn qc thăng long', dong: [{ sp: 'thấu kính', sl: 13, gia: 80000 }] },
      // Lượt 2: model trích được TÊN HÀNG từ câu NV tả lại — đây chính là tín
      // hiệu mà hàng rào tra-lại dựa vào (xem chú thích trong gom-don/index).
      { dong: [{ sp: 'led dây ziczac thấu kính 12v-30d' }] },
    ]);
    await goi('lên đơn a tuấn qc thăng long 13 cuộn thấu kính giá 80k 1 cuộn', 4001);
    const truoc = tinGui.length;
    await goi('led dây ziczac thấu kính 12v-30d', 4002);
    const sau = tinGui.slice(truoc).join('\n');
    // Cái đỏ trước khi vá: 'Em vẫn chưa khớp được "led dây ziczac thấu kính 12v-30d"…'
    expect(sau).not.toMatch(/vẫn chưa khớp được/i);
    expect(sau).toMatch(/zic[hz]?zac/i);
  });

  it('câu KHÔNG phải tên hàng ("ko chuẩn rồi") vẫn đi đường cũ, không tra bừa', async () => {
    const { goi, tinGui } = dungMay([
      { lenDon: true, khach: 'a tuấn qc thăng long', dong: [{ sp: 'thấu kính', sl: 13, gia: 80000 }] },
      // "ko chuẩn rồi" không tả hàng nào → model không trích ra `dong[].sp`.
      {},
    ]);
    await goi('lên đơn a tuấn qc thăng long 13 cuộn thấu kính giá 80k 1 cuộn', 5001);
    const truoc = tinGui.length;
    await goi('ko chuẩn rồi', 5002);
    // Không được tự chốt hàng nào từ một câu chê — vẫn phải hỏi lại.
    expect(tinGui.slice(truoc).join('\n')).not.toMatch(/Đã lên đơn/i);
  });
});
