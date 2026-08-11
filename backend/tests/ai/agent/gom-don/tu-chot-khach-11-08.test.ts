// SPDX-License-Identifier: AGPL-3.0-or-later
// MÁY GOM ĐƠN TỰ CHỐT KHÁCH khi có người khớp gần nguyên văn và áp đảo.
//
// Yêu cầu anh Quốc 21:56 11/08/2026: "có cách nào search thông minh hơn không
// nhỉ? ví dụ trên nv nói 'a Long led' thì kết quả có kết quả là 'Anh Long Led'
// thì lấy luôn thôi còn mấy khách khác thì là khác hẳn tên mà".
//
// Ca thật đang hỏng:
//   NV : "a Long led. 100 cái 5v60a không quạt giá 230k. Chiết khấu 8%. @bot lên đơn cho a"
//   Bot: Có 8 khách tên "Long Led": 1) Anh Long Led · KH000117 … 8 kết quả
//        Anh/chị chọn giúp em (vd: 1) ạ.        ← thừa một lượt, 7 kết quả rác
//
// Danh sách khách/SP trong file này là DỮ LIỆU THẬT lấy từ Odoo prod 11/08.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import { boDau } from '../../../../src/modules/ai/odoo/tools/tra-san-pham.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';
import { ilikeChua } from '../../odoo/ilike-gia.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** 8 khách THẬT khớp "long"+"led" trên prod — chỉ 1 người là đúng. */
const KHACH = [
  { id: 3434, name: 'Anh Long Led', ref: 'KH000117', phone: '0943181986' },
  { id: 1879, name: 'LED - Anh Đoàn Bình - Long Biên', ref: 'KH001695- ACDL', phone: false },
  { id: 2543, name: 'LED DIÊU LINH 64 TRẦN PHÚ HÀ KHÁNH HẠ LONG -  0979 090 091', ref: 'KH001022', phone: false },
  { id: 607, name: 'Led Hoàng Long', ref: 'KH002802', phone: false },
  { id: 2008, name: 'Led Kim Long', ref: 'KH001564- ACDL', phone: false },
  { id: 831, name: 'Led Long Thành - Thái Bình', ref: 'KH002615ACDL', phone: false },
  { id: 2641, name: 'Led Phi Long- HCM', ref: 'KH000922-ACDL', phone: false },
  { id: 2858, name: 'led bảo long -Anh long - Sn 290 việt bắc tp thái nguyên 0962801888', ref: 'KH000701- ACDL', phone: false },
  // Ca BẪY "Cảnh tam kỳ" — cùng bảng để một fakeOdoo lo được cả hai kịch bản.
  { id: 3803, name: 'Anh Cảnh - Led Việt - Tam Kỳ', ref: 'KH003067ACDL', phone: false },
  { id: 3352, name: 'Anh Cảnh Tam Kỳ', ref: 'KH000202- ACDL', phone: false },
  // Ca "anh Thức" — hai người ngang nhau.
  { id: 1462, name: 'Anh Thức CNC', ref: 'KH002090', phone: false },
  { id: 889, name: 'Anh Thức- Nam ĐỊnh', ref: 'KH002559AC', phone: false },
].map((p) => ({ ...p, mobile: false, incokit_receivable_balance: 0 }));

const SP = [
  { id: 3, name: 'Nguồn Rong 5V60A Mỏng Không Quạt MA300SH5F (cái)', default_code: false, list_price: 230000, uom_id: [1, 'Cái'] },
];

/** LLM giả — trích slot đúng như prod vẫn trích. */
function fakeGenerate(khach: string): ToolAwareGenerate {
  return async () => ({
    text: '', stopReason: 'tool_use', raw: null, usage,
    toolCalls: [{
      id: 't1', name: 'ghi_slot',
      input: { lenDon: true, khach, dong: [{ sp: '5v60a không quạt', sl: 100, gia: 230000 }] },
    }],
  });
}

function fakeOdoo() {
  const searchRead = vi.fn(async (model: string, domain: unknown[], _f: unknown, opts?: { limit?: number }) => {
    if (model === 'res.partner') {
      const tokens = (domain as unknown[][])
        .filter((d) => Array.isArray(d) && d[0] === 'name' && d[1] === 'ilike')
        .map((d) => String(d[2]));
      const khop = tokens.length > 0
        ? KHACH.filter((p) => tokens.every((t) => ilikeChua(t, p.name)))
        : KHACH;
      return khop.slice(0, opts?.limit ?? khop.length);
    }
    if (model === 'product.product') {
      const dkGia = (domain as unknown[][]).find((d) => Array.isArray(d) && d[0] === 'list_price');
      if (dkGia?.[1] === '>') return SP.filter((p) => p.list_price > Number(dkGia[2]));
      if (dkGia?.[1] === '<=') return SP.filter((p) => p.list_price <= Number(dkGia[2]));
      return SP;
    }
    // Bỏ bước chốt (11/08): đủ thông tin là tạo đơn NGAY trong lượt, rồi tool
    // đọc lại đơn vừa tạo để xác nhận. Tra client_order_ref (chống trùng) phải
    // rỗng; tra theo id → trả đơn nháp.
    if (model === 'sale.order') {
      if (JSON.stringify(domain).includes('client_order_ref')) return [];
      return [{ id: 777, name: 'S13830', state: 'draft', amount_total: 23000000, amount_untaxed: 23000000 }];
    }
    return [];
  });
  return { searchRead, execute: vi.fn(async () => 777) };
}

function fakeDb() {
  const rows = new Map<string, { orgId: string; conversationId: string; slots: unknown; hetHan: Date }>();
  return {
    phienGomDon: {
      findUnique: async ({ where }: { where: { conversationId: string } }) => rows.get(where.conversationId) ?? null,
      upsert: async ({ where, create, update }: {
        where: { conversationId: string }; create: never; update: { slots: unknown; hetHan: Date };
      }) => {
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

function dungMay(khachLlmTrich: string) {
  const tinGui: string[] = [];
  const deps: GomDonDeps = {
    prisma: fakeDb() as never,
    odoo: fakeOdoo() as never,
    generate: fakeGenerate(khachLlmTrich),
    anhClient: null,
    odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {},
    ghiLog: () => {},
  };
  const goi = (cau: string) => xuLyGomDon(deps, { orgId: 'o1', conversationId: `c${Math.random()}`, seq: 1, cau });
  return { goi, tinGui };
}

describe('tự chốt khách khi khớp gần nguyên văn (yêu cầu 21:56 11/08)', () => {
  it('"a Long led" → LẤY LUÔN Anh Long Led, KHÔNG bắt chọn', async () => {
    const m = dungMay('a Long led');
    await m.goi('a Long led. 100 cái 5v60a không quạt giá 230k. Chiết khấu 8%. lên đơn cho a');

    const tin = m.tinGui.join('\n');
    // Không còn danh sách 8 người.
    expect(tin).not.toContain('chọn giúp em');
    expect(tin).not.toMatch(/Có \d+ khách tên/);
    // Đơn lên cho ĐÚNG người.
    expect(tin).toContain('Anh Long Led');
    expect(tin).toContain('KH000117');
  });

  it('PHẢI NÓI RÕ đã lấy ai — không chốt im lặng', async () => {
    // Anh Quốc: "Khi tự chốt, PHẢI nói rõ đã chọn ai … nhân viên cần thấy để
    // sửa nếu sai." Tin phải nêu cả tên LẪN mã KH.
    const m = dungMay('a Long led');
    await m.goi('a Long led. 100 cái 5v60a không quạt giá 230k. lên đơn cho a');

    const tin = m.tinGui.join('\n');
    expect(tin).toMatch(/Anh Long Led/);
    expect(tin).toMatch(/KH000117/);
    // Có câu cho phép sửa nếu bot lấy nhầm.
    expect(tin).toMatch(/không đúng|nhầm|sai|báo em|đổi/i);
  });

  it('"Cảnh tam kỳ" → VẪN HỎI (chống chốt nhầm khách — test quan trọng nhất)', async () => {
    // Đêm 11/08 anh Quốc gõ "Cảnh tam kỳ" rồi chọn "Anh Cảnh - Led Việt - Tam
    // Kỳ" (KH003067ACDL), KHÔNG phải "Anh Cảnh Tam Kỳ" khớp nguyên văn. Tự chốt
    // ở đây là lên đơn sai người (tiền lệ: S13814 07/08 phải huỷ).
    const m = dungMay('Cảnh tam kỳ');
    await m.goi('Cảnh tam kỳ. 100 cái 5v60a không quạt giá 230k. lên đơn cho a');

    const tin = m.tinGui.join('\n');
    expect(tin).toContain('chọn giúp em');
    // Phải hiện CẢ HAI người cho nhân viên tự quyết.
    expect(tin).toContain('Anh Cảnh Tam Kỳ');
    expect(tin).toContain('Anh Cảnh - Led Việt - Tam Kỳ');
  });

  it('"anh Thức" (2 người ngang nhau) → VẪN HỎI', async () => {
    const m = dungMay('anh Thức');
    await m.goi('anh Thức. 100 cái 5v60a không quạt giá 230k. lên đơn cho a');

    const tin = m.tinGui.join('\n');
    expect(tin).toContain('chọn giúp em');
    expect(tin).toContain('Anh Thức CNC');
    expect(tin).toContain('Anh Thức- Nam ĐỊnh');
  });
});
