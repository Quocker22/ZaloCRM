// SPDX-License-Identifier: AGPL-3.0-or-later
// REPLAY CA THẬT — 19:42-19:48 ngày 12/08/2026, "cảm giác nó tù tù".
//
//   19:42:53  NV : [Ảnh] "@bot lên đơn cho anh Led Kim Long các sản phẩm trong ảnh"
//   19:43:04  Bot: 'Em không tìm thấy sản phẩm: "QC-LHR15W...", "QC-LH3B6313T...",
//                   "QC-LH6011D..."' (mã QC-* không có trong catalog)
//   19:48:29  NV : "thôi bỏ các sản phẩm không rõ ràng lên đơn đi"
//   19:48:32  Bot: "Em bỏ đơn đang gom dở nhé. Đơn này lên cho khách nào ạ?"
//                  ↑ hiểu "bỏ đơn" thay vì "bỏ VÀI DÒNG" — mất khách + dòng đã khớp
//
// Anh Quốc: "tôi vẫn cảm giác nó tù tù sao á cảm giác nó không linh động được".
//
// HAI bản vá cùng lượt, test cả hai:
//   1. Câu chứa "lên đơn" KHÔNG mang khách mới → GIỮ phiên (đường thoát 1 phải
//      trích slot rồi so khách, không đoán bằng regex động từ).
//   2. "bỏ các sản phẩm không rõ ràng" = bỏ DÒNG CHƯA CHỐT bằng code — model
//      không map được cụm đó vào tên hàng nào.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';
import { ilike, khopDomain } from '../../odoo/ilike-gia.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** Odoo giả: khách Led Kim Long có sẵn; catalog CÓ "Led Bulb 9W" nhưng KHÔNG có mã QC-*. */
function fakeOdoo() {
  const kh = [{ id: 88, name: 'Công Ty Led Kim Long', ref: 'KH000088', phone: false }];
  const products = [
    { id: 701, name: 'Led Bulb 9W Trắng', default_code: 'SP000701', list_price: 50000, uom_id: [1, 'Cái'] },
    { id: 810, name: 'p10 full out LLR 260330', default_code: 'P10FO-LLR', list_price: 175000, uom_id: [3, 'Tấm'] },
  ];
  const donDaGhi = new Map<string, { id: number; name: string }>();
  let idKe = 28001;
  const searchRead = vi.fn(async (model: string, domain: unknown[], fields?: unknown, opts?: { limit?: number }) => {
    const s = JSON.stringify(domain);
    if (model === 'res.partner') return kh;
    if (model === 'product.product') {
      const theoId = (domain as unknown[][]).find((d) => Array.isArray(d) && d[0] === 'id' && d[1] === 'in');
      if (theoId) return products.filter((p) => (theoId[2] as number[]).includes(p.id));
      if (JSON.stringify(fields ?? []).includes('incokit_stock_breakdown')) {
        return products.map((p) => ({ id: p.id, name: p.name, incokit_stock_breakdown: [] }));
      }
      const g = (domain as unknown[]).find(
        (d): d is [string, string, number] => Array.isArray(d) && d[0] === 'list_price');
      if (g && g[1] === '<=') return [];
      return products.filter((p) => khopDomain(domain, (dk) =>
        dk[0] === 'name' && dk[1] === 'ilike' ? ilike(`%${String(dk[2])}%`, p.name)
          : dk[0] === 'default_code' && dk[1] === 'ilike' ? ilike(`%${String(dk[2])}%`, p.default_code)
            : true)).slice(0, opts?.limit ?? 10);
    }
    if (model === 'sale.order') {
      if (s.includes('client_order_ref')) {
        const m = s.match(/zalo:[^"]+/);
        const cu = m ? donDaGhi.get(m[0]) : undefined;
        return cu ? [{ ...cu, state: 'draft', amount_total: 500000, client_order_ref: m[0] }] : [];
      }
      return [{ id: idKe - 1, name: `S${15000}`, state: 'draft', amount_total: 500000, amount_untaxed: 500000 }];
    }
    return [];
  });
  const execute = vi.fn(async (model: string, method: string, args?: unknown) => {
    if (model === 'sale.order' && method === 'create') {
      const vals = (args as Array<Record<string, unknown>>)[0];
      const id = idKe++;
      donDaGhi.set(String(vals.client_order_ref ?? ''), { id, name: 'S15000' });
      return id;
    }
    return idKe;
  });
  return { searchRead, execute };
}

/** Model giả — lượt 1 trích đủ (1 SP có thật + 2 mã QC-* không có); lượt 2 chỉ lenDon. */
function fakeGenerate(): ToolAwareGenerate {
  return async (a) => {
    const nd = String(a.messages[0].content);
    let input: Record<string, unknown> = {};
    if (nd.includes('các sản phẩm trong ảnh')) {
      input = {
        lenDon: true, khach: 'Led Kim Long',
        dong: [
          { sp: 'Led Bulb 9W Trắng', sl: 10 },
          { sp: 'QC-LHR15W Led hắt rọi 1,5W', sl: 50 },
          { sp: 'QC-LH3B6313T Led hắt 3 bóng', sl: 30 },
        ],
      };
    } else if (nd.includes('10 cái led bulb')) {
      // Ca MỘT LƯỢT: mọi dòng đều khớp catalog → đủ slot, đơn ra ngay.
      input = { lenDon: true, khach: 'Led Kim Long', dong: [{ sp: 'Led Bulb 9W Trắng', sl: 10 }] };
    } else if (nd.includes('bỏ các sản phẩm không rõ ràng')) {
      // Hình dạng thật: model thấy "lên đơn" thì bật lenDon; "các sản phẩm
      // không rõ ràng" không phải tên hàng nên boDong trống.
      input = { lenDon: true };
    }
    return { text: '', stopReason: 'tool_use', raw: null, usage, toolCalls: [{ id: 't1', name: 'ghi_slot', input }] };
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

function dungMay(cid = 'c-19-48', luatNhanVien?: string[]) {
  const odoo = fakeOdoo();
  const db = fakeDb();
  const tinGui: string[] = [];
  const deps: GomDonDeps = {
    prisma: db as never, odoo: odoo as never, generate: fakeGenerate(),
    anhClient: null, odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {}, ghiLog: () => {},
    ...(luatNhanVien ? { luatNhanVien } : {}),
  };
  return {
    goi: (cau: string, seq: number) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId: cid, seq, cau, senderUid: 'uid-quoc',
    }),
    tinGui, odoo, db,
  };
}

describe('ca thật 19:42-19:48 12/08 — "bỏ các SP không rõ ràng lên đơn đi"', () => {
  it('GIỮ khách Led Kim Long, BỎ đúng các dòng chưa khớp, và RA ĐƠN', async () => {
    const { goi, tinGui, odoo } = dungMay();

    await goi('lên đơn cho anh Led Kim Long các sản phẩm trong ảnh', 19421);
    // Bot đã báo "không tìm thấy" các mã QC-* — phiên còn mở với khách + 1 dòng khớp.
    // Câu chữ mới 22:06 12/08: gạch đầu dòng từng SP (yêu cầu anh Quốc).
    expect(tinGui.join('\n')).toContain('không tìm thấy các sản phẩm sau');
    expect(tinGui.join('\n')).toContain('- "QC-LHR15W');

    const tinTruoc = tinGui.length;
    await goi('thôi bỏ các sản phẩm không rõ ràng lên đơn đi', 19482);
    const tinSau = tinGui.slice(tinTruoc).join('\n');

    // KHÔNG được vứt phiên và hỏi lại khách — đúng cái làm anh Quốc nản.
    expect(tinSau).not.toContain('bỏ đơn đang gom dở');
    expect(tinSau).not.toContain('lên cho khách nào');
    // Đơn phải RA với dòng đã khớp (Led Bulb 9W) cho đúng khách cũ.
    const daTao = odoo.execute.mock.calls.filter(
      (c) => String(c[0]) === 'sale.order' && String(c[1]) === 'create').length;
    expect(daTao).toBe(1);
    expect(tinSau).toContain('Led Kim Long');
  });

  it('bỏ đến mức KHÔNG còn dòng chốt nào → không lặng lẽ ra đơn rỗng', async () => {
    // Phiên chỉ toàn dòng chưa khớp → câu "bỏ các SP không rõ" không được lọc
    // (điều kiện đòi còn ≥1 dòng đã chốt) — máy hỏi tiếp như thường.
    const odoo = fakeOdoo();
    const db = fakeDb();
    const tinGui: string[] = [];
    const gen: ToolAwareGenerate = async (a) => {
      const nd = String(a.messages[0].content);
      const input: Record<string, unknown> = nd.includes('trong ảnh')
        ? { lenDon: true, khach: 'Led Kim Long', dong: [{ sp: 'QC-KHONG-CO', sl: 5 }] }
        : { lenDon: true };
      return { text: '', stopReason: 'tool_use', raw: null, usage, toolCalls: [{ id: 't1', name: 'ghi_slot', input }] };
    };
    const deps: GomDonDeps = {
      prisma: db as never, odoo: odoo as never, generate: gen,
      anhClient: null, odooUrl: 'https://odoo.example.com',
      guiTin: async (t) => { tinGui.push(t); }, guiAnhHoaDon: async () => {}, ghiLog: () => {},
    };
    const goi = (cau: string, seq: number) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId: 'c-rong', seq, cau, senderUid: 'uid-quoc',
    });

    await goi('lên đơn cho anh Led Kim Long các sản phẩm trong ảnh', 21001);
    await goi('thôi bỏ các sản phẩm không rõ ràng lên đơn đi', 21002);

    const daTao = odoo.execute.mock.calls.filter(
      (c) => String(c[0]) === 'sale.order' && String(c[1]) === 'create').length;
    expect(daTao).toBe(0);
  });
});

describe('luật chiết khấu NV dặn — ca MỘT LƯỢT (đơn ra ngay), vá lần 2 12/08', () => {
  // E2E prod bắt được: lời gọi sau dapSlot chạy TRƯỚC vòng tra khách, ca
  // 1-lượt thì khách chốt xong là đơn ra luôn — luật chưa kịp áp (S13840
  // không chiết khấu). Lời gọi thứ hai ở đầu nhánh tao_don chữa đúng ca này.
  it('"lên đơn cho Led Kim Long 10 cái..." → đơn ra NGAY đã kèm 5%', async () => {
    const { goi, odoo } = dungMay('c-ck-1-luot',
      ['Khách Led Kim Long luôn chiết khấu 5% (khi: khách Led Kim Long)']);

    // Mọi dòng đều khớp catalog → khách chốt + đủ slot → đơn ra CÙNG lượt.
    await goi('lên đơn cho anh Led Kim Long 10 cái led bulb', 31001);

    const taoDon = odoo.execute.mock.calls.find(
      (c) => String(c[0]) === 'sale.order' && String(c[1]) === 'create');
    expect(taoDon, 'đơn phải được tạo trong lượt đầu').toBeTruthy();
    // Dòng hàng trong vals phải mang discount 5 từ luật.
    expect(JSON.stringify(taoDon![2])).toContain('"discount":5');
  });
});

describe('gợi ý gần giống khi tay trắng — bỏ SỐ LÔ tra lại (yêu cầu 22:06)', () => {
  it('"P10 Full Out 260626" (lô mới) → ứng viên "p10 full out LLR 260330", hỏi chọn', async () => {
    const odoo = fakeOdoo();
    const db = fakeDb();
    const tinGui: string[] = [];
    const gen: ToolAwareGenerate = async () => ({
      text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't1', name: 'ghi_slot', input: {
        lenDon: true, khach: 'Led Kim Long', dong: [{ sp: 'P10 Full Out 260626', sl: 100 }],
      } }],
    });
    const deps: GomDonDeps = {
      prisma: db as never, odoo: odoo as never, generate: gen,
      anhClient: null, odooUrl: 'https://odoo.example.com',
      guiTin: async (t) => { tinGui.push(t); }, guiAnhHoaDon: async () => {}, ghiLog: () => {},
    };
    await xuLyGomDon(deps, { orgId: 'o1', conversationId: 'c-goi-y', seq: 41001, cau: 'lên đơn cho anh Led Kim Long 100 tấm P10 Full Out 260626', senderUid: 'u' });

    const tin = tinGui.join('\n');
    // KHÔNG bó tay, KHÔNG tự chốt — đưa hàng lô cũ ra hỏi.
    expect(tin).not.toContain('không tìm thấy các sản phẩm');
    expect(tin).toContain('LLR 260330');
    expect(tin).toMatch(/a\)/);
    // Không được lặng lẽ tạo đơn với hàng đoán.
    const daTao = odoo.execute.mock.calls.filter((c) => String(c[1]) === 'create').length;
    expect(daTao).toBe(0);
  });
});

describe('lệnh "tạo mới <tên>" trong phiếu nhập (yêu cầu 22:06)', () => {
  const dungMayNhap = (execute: ReturnType<typeof vi.fn>) => {
    const odoo = fakeOdoo();
    (odoo as { execute: unknown }).execute = execute;
    const db = fakeDb();
    const tinGui: string[] = [];
    const gen: ToolAwareGenerate = async (a) => {
      const nd = String(a.messages[0].content);
      const input: Record<string, unknown> = nd.includes('phiếu nhập')
        ? { nhapHang: true, khach: 'Led Kim Long', dong: [{ sp: 'QC-KHONG-CO-THAT', sl: 5 }] }
        : {};
      return { text: '', stopReason: 'tool_use', raw: null, usage, toolCalls: [{ id: 't1', name: 'ghi_slot', input }] };
    };
    const deps: GomDonDeps = {
      prisma: db as never, odoo: odoo as never, generate: gen,
      anhClient: null, odooUrl: 'https://odoo.example.com',
      guiTin: async (t) => { tinGui.push(t); }, guiAnhHoaDon: async () => {}, ghiLog: () => {},
    };
    return {
      goi: (cau: string, seq: number) => xuLyGomDon(deps, { orgId: 'o1', conversationId: 'c-tao-moi-' + seq, seq, cau, senderUid: 'u' }),
      goiCung: (cid: string) => (cau: string, seq: number) => xuLyGomDon(deps, { orgId: 'o1', conversationId: cid, seq, cau, senderUid: 'u' }),
      tinGui,
    };
  };

  it('có quyền → tạo SP, chốt vào dòng, báo rõ đã tạo', async () => {
    const execute = vi.fn(async (_m: string, method: string) => (method === 'create' ? 9001 : 1));
    const { goiCung, tinGui } = dungMayNhap(execute);
    const goi = goiCung('c-tm-ok');

    await goi('tạo phiếu nhập cho Led Kim Long 5 cái QC-KHONG-CO-THAT', 51001);
    await goi('tạo mới QC-KHONG-CO-THAT', 51002);

    expect(execute.mock.calls.some((c) => String(c[1]) === 'create' && String(c[0]) === 'product.product')).toBe(true);
    expect(tinGui.join('\n')).toContain('Em đã tạo mới 1 sản phẩm');
  });

  it('bị chặn quyền → nói thật + chỉ đường cấp quyền, KHÔNG im', async () => {
    const execute = vi.fn(async (_m: string, method: string) => {
      if (method === 'create') throw new Error('Liên hệ với quản trị viên');
      return 1;
    });
    const { goiCung, tinGui } = dungMayNhap(execute);
    const goi = goiCung('c-tm-chan');

    await goi('tạo phiếu nhập cho Led Kim Long 5 cái QC-KHONG-CO-THAT', 52001);
    await goi('tạo mới QC-KHONG-CO-THAT', 52002);

    expect(tinGui.join('\n')).toContain('chưa được cấp quyền tạo sản phẩm');
  });
});

describe('huỷ phải chắc như nút ESC (ca 08:59 12/08 — "bỏ đơn này đi" bị giam)', () => {
  it('"bỏ đơn này đi" → xoá phiên NGAY, một phát ăn luôn', async () => {
    const { goi, tinGui, db } = dungMay('c-huy-chac');

    await goi('lên đơn cho anh Led Kim Long các sản phẩm trong ảnh', 61001);
    expect(db.rows.has('c-huy-chac')).toBe(true);

    await goi('bỏ đơn này đi', 61002);

    expect(tinGui.join('\n')).toContain('Em huỷ đơn đang gom rồi ạ');
    expect(db.rows.has('c-huy-chac')).toBe(false);
  });

  it('"bỏ sản phẩm Card HD ra khỏi đơn" KHÔNG phải huỷ — không có tin huỷ nào', async () => {
    // Câu có tên hàng chen giữa "bỏ ... đơn" là lệnh BỎ DÒNG, không phải
    // thoát. (Phiên có thể kết thúc vì RA ĐƠN với dòng còn lại — đó là luật
    // "đủ slot = lên luôn" của anh Quốc, không phải huỷ.)
    const { goi, tinGui } = dungMay('c-bo-dong-1');

    await goi('lên đơn cho anh Led Kim Long các sản phẩm trong ảnh', 62001);
    await goi('bỏ sản phẩm Card HD ra khỏi đơn', 62002);

    expect(tinGui.join('\n')).not.toContain('Em huỷ đơn đang gom');
  });
});
