// SPDX-License-Identifier: AGPL-3.0-or-later
// KỊCH BẢN REPLAY — nguyên văn chat hỏng 23:22 ngày 11/08/2026.
//
//   23:22:31  NV : [Ảnh danh sách hàng] "@Tiểu Mã Nelia tạo phiếu nhập hàng
//                   giúp tôi nhà cung cấp là Trung Quốc"
//   23:22:43  Bot: "Có 2 nhà cung cấp tên Trung Quốc: 1) ... 2) ... chọn giúp em"
//   23:22:49  NV : "1"
//   23:22:50  Bot: "Anh/chị nhập những hàng gì ạ? (tên hàng + số lượng, có giá
//                   nhập càng tốt)"   ← HỎI LẠI thứ ĐÃ CÓ TRONG ẢNH
//
// Anh Quốc: "ủa là sao? sản phẩm rồi số lượng trong ảnh mà".
//
// ─── ĐO THẬT: ZALO GỬI ĐÚNG MỘT TIN, KHÔNG PHẢI HAI ───────────────────────
//   16:22:32.703 | image | {"title":"@Tiểu Mã Nelia tạo phiếu nhập hàng ...
//   16:22:50.277 | text  | 1
// Lời nhắn nằm trong `title` của tin ẢNH. Không có tin chữ riêng, nên toàn bộ
// việc đi qua đúng một đường: luong-media → docAnh → xuLyTinNhanVien → gom-don.
//
// ─── NỘI DUNG ẢNH BỊ MẤT Ở ĐÂU ────────────────────────────────────────────
// Đã đo lại TỪNG HÀM một, không hàm nào nuốt mất chuỗi:
//   `boQuote`               — neo `^`, chỉ cắt tiền tố quote ở ĐẦU câu; khối
//                             `[Khách gửi ảnh…]` nằm ở CUỐI nên không bị đụng.
//   `khoaViec`/`thuGiuViec` — một tin, một lượt, không có gì để khoá nhau.
//   `nhanDienLenhNhanVien`  — chạy thử đúng chuỗi thật: phần sau xuống dòng đi
//                             qua NGUYÊN VẸN, nó chỉ cắt đúng cái tag.
// (Dòng log `{ noiDung: '@Tiểu Mã Nelia tạo phiếu nhập hàng giúp tôi nhà cu' }`
//  trông như bị cắt, nhưng đó là `slice(0, 50)` của chính câu log — không phải
//  dấu vết mất dữ liệu.)
//
// Mất ở LỜI DẶN TRÍCH SLOT: prompt `trichSlot` viết cho "MỘT câu của nhân viên
// bán hàng" và chưa từng nhắc tới khối `[Khách gửi ảnh, nội dung trong ảnh:
// ...]`. Model đọc khối đó như văn bản nền — nó trích được ý định (nhapHang) và
// tên NCC từ lời nhắn, rồi BỎ QUA danh sách hàng trong ảnh. Phiên vào chế 'nhap'
// với `dong` RỖNG → `buocTiepTheo` trả `hoi_thieu: 'sp'` → đúng câu 23:22:50.
//
// Test này khoá: nội dung ảnh phải tới được máy gom đơn ở CẢ BA chế (lên đơn,
// sửa đơn, nhập hàng), tới được cả khi PHIÊN ĐANG MỞ, và khối `[Trả lời tin:...]`
// vẫn phải bị cắt như cũ.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import { trichSlot } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/trich-slot.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/**
 * Nguyên văn nội dung ảnh model đọc được lúc 23:22:4x (log `[doc-anh] đã đọc ảnh`).
 * Đây là DANH SÁCH HÀNG viết tay: tên + số lượng từng dòng.
 *
 * Con số lấy từ lần chạy `docAnh` THẬT trên chính ảnh đó (prod 11/08,
 * gpt-4.1-mini): "P10 full out: 10.000 tấm" và "P5 full out: 1460 tấm".
 */
const NOI_DUNG_ANH = [
  '- P10 full out: 10.000 tấm',
  '- P5 full out: 1.460 tấm',
].join('\n');

/** Lời nhắn NV gõ kèm ảnh — nằm trong `title` của tin ảnh (mention Zalo thô). */
const LOI_NHAN = '@Tiểu Mã Nelia tạo phiếu nhập hàng giúp tôi nhà cung cấp là Trung Quốc';

/** Câu `luong-media.docVaChuyenTiep` ghép ra và ném vào luồng nhân viên. */
const CAU_23_22 = `${LOI_NHAN}\n[Khách gửi ảnh, nội dung trong ảnh: ${NOI_DUNG_ANH}]`;

/**
 * LLM giả mô phỏng ĐÚNG hành vi model thật ở ca 23:22: nó đọc lời nhắn, trả
 * `nhapHang` + tên NCC, nhưng CHỈ trích được danh sách hàng KHI prompt có dặn
 * đọc khối `[Khách gửi ảnh...]`.
 *
 * Đây là điểm mấu chốt của test: fake KHÔNG được tự động trích hàng từ mọi
 * chuỗi. Nó chỉ trích khi lời dặn (system prompt) thật sự nói về nội dung ảnh —
 * y như model thật, thứ chỉ làm cái nó được dặn.
 */
function fakeGenerate(): ToolAwareGenerate {
  return async (a) => {
    const dan = String(a.system ?? '');
    const nd = String(a.messages[0].content);
    // Model chỉ "nhìn thấy" hàng trong ảnh khi lời dặn có nhắc ĐÚNG nhãn khối
    // `[Khách gửi ảnh` — không phải chữ "ảnh" bất kỳ. Prompt cũ vốn đã chứa
    // "GỬI ẢNH hoá đơn" (dòng phân biệt VAT), nên bắt chữ "ảnh" chung chung là
    // dương tính giả và test sẽ xanh dù chưa sửa gì.
    const danDocAnh = /\[Khách gửi ảnh/.test(dan);
    const coKhoiAnh = nd.includes('[Khách gửi ảnh');
    const hangTrongAnh = danDocAnh && coKhoiAnh
      ? [
          { sp: 'P10 full out', sl: 10000 },
          { sp: 'P5 full out', sl: 1460 },
        ]
      : [];

    const input: Record<string, unknown> = {};
    if (/phiếu nhập|nhập hàng/i.test(nd)) {
      input.nhapHang = true;
      input.khach = 'Trung Quốc';
    } else if (/lên đơn/i.test(nd)) {
      input.lenDon = true;
      input.khach = 'Trung Quốc';
    } else if (/sửa đơn/i.test(nd)) {
      input.sua = true;
    }
    if (hangTrongAnh.length > 0) input.dong = hangTrongAnh;
    // Câu chỉ có khối ảnh (bổ sung giữa phiên) — không có ý định mới nào.
    if (Object.keys(input).length === 0 && hangTrongAnh.length === 0) input.ngoaiLe = true;

    return {
      text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't1', name: 'ghi_slot', input }],
    };
  };
}

/**
 * Khớp một mẫu LIKE của Odoo/Postgres: `_` = đúng MỘT ký tự bất kỳ, `%` = nhiều,
 * `\` thoát. Fake phải hiểu wildcard vì tầng tra cứu dùng mẫu không-dấu
 * ("trung quoc" → "tr_ng qu_c") để lách chuyện `ilike` không bỏ dấu trên prod.
 */
function khopLike(chuoi: string, mau: string): boolean {
  let re = '';
  for (let i = 0; i < mau.length; i++) {
    const c = mau[i];
    if (c === '\\') { re += mau[++i]?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') ?? ''; continue; }
    if (c === '_') { re += '.'; continue; }
    if (c === '%') { re += '.*'; continue; }
    re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re, 'i').test(chuoi);
}

function fakeOdoo() {
  const ncc = [{ id: 314, name: 'Trung Quốc', ref: 'NCC000001', supplier_rank: 5 }];
  const khach = [{ id: 2519, name: 'Trung Quốc', ref: 'KH001046', supplier_rank: 0 }];
  const products = [
    { id: 901, name: 'Màn hình LED P10 full out', default_code: 'P10FO', list_price: 4500, uom_id: [1, 'Tấm'] },
    { id: 902, name: 'Màn hình LED P5 full out', default_code: 'P5FO', list_price: 6200, uom_id: [1, 'Tấm'] },
  ];

  const searchRead = vi.fn(async (model: string, domain: unknown[], _f: unknown, opts?: { limit?: number }) => {
    const s = JSON.stringify(domain);
    if (model === 'res.partner') {
      const theoId = (domain as unknown[][]).find((d) => Array.isArray(d) && d[0] === 'id' && d[1] === '=');
      if (theoId) return [...ncc, ...khach].filter((p) => p.id === Number(theoId[2]));
      const nguon = s.includes('supplier_rank') ? ncc : khach;
      const tokens = (domain as unknown[][])
        .filter((d) => Array.isArray(d) && d[0] === 'name' && d[1] === 'ilike')
        .map((d) => String(d[2]).toLowerCase());
      const khop = tokens.length > 0
        ? nguon.filter((p) => tokens.every((t) => khopLike(p.name, t)))
        : nguon;
      return khop.slice(0, opts?.limit ?? 10);
    }
    if (model === 'product.product') {
      const theoId = (domain as unknown[][]).find((d) => Array.isArray(d) && d[0] === 'id' && d[1] === 'in');
      if (theoId) return products.filter((p) => (theoId[2] as number[]).includes(p.id));
      const g = (domain as unknown[]).find(
        (d): d is [string, string, number] => Array.isArray(d) && d[0] === 'list_price');
      if (g && g[1] === '>') return [];
      const tokens = (domain as unknown[][])
        .filter((d) => Array.isArray(d) && d[0] === 'name' && d[1] === 'ilike')
        .map((d) => String(d[2]).toLowerCase());
      return tokens.length > 0
        ? products.filter((p) => tokens.every((t) => khopLike(p.name, t)))
        : products;
    }
    if (model === 'purchase.order') {
      if (s.includes('origin') && !s.includes('"id"')) return [];
      return [{ id: 7001, name: 'P04530', state: 'draft', amount_total: 0, origin: 'zalo:c-anh:1' }];
    }
    if (model === 'sale.order') {
      // `client_order_ref` = khoá chống-trùng (idempotency) của đơn BÁN. Trả
      // rỗng: cuộc này CHƯA có đơn nào, để máy tạo đơn mới thay vì báo
      // "đã tạo trước đó rồi" và bỏ qua phần tóm tắt hàng.
      if (s.includes('client_order_ref')) return [];
      return [{ id: 8001, name: 'S13900', state: 'draft', amount_total: 0, create_date: '2026-08-11 16:00:00' }];
    }
    return [];
  });

  return { searchRead, execute: vi.fn(async () => 7001) };
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

function dungMay(conversationId = 'c-anh') {
  const odoo = fakeOdoo();
  const db = fakeDb();
  const tinGui: string[] = [];
  const deps: GomDonDeps = {
    prisma: db as never, odoo: odoo as never, generate: fakeGenerate(),
    anhClient: null, odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {},
    ghiLog: () => {},
  };
  let seq = 0;
  return {
    goi: (cau: string) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId, seq: ++seq, cau, senderUid: 'uid-quoc',
    }),
    tinGui, odoo, db,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. LỜI DẶN TRÍCH SLOT phải dạy model đọc khối ảnh — đây là chỗ đã đứt.
describe('lời dặn trích slot — phải nói rõ về khối [Khách gửi ảnh]', () => {
  it('system prompt dặn model coi nội dung trong ảnh là hàng thật', async () => {
    const goi: Array<{ system?: string }> = [];
    const g: ToolAwareGenerate = async (a) => {
      goi.push(a as { system?: string });
      return { text: '', stopReason: 'tool_use', raw: null, usage, toolCalls: [{ id: 't', name: 'ghi_slot', input: {} }] };
    };

    await trichSlot(g, CAU_23_22, null);

    const dan = String(goi[0].system ?? '');
    // Phải nhắc ĐÚNG nhãn khối. Prompt cũ có sẵn chữ "GỬI ẢNH hoá đơn" ở dòng
    // phân biệt VAT — bắt chữ "ảnh" chung chung là dương tính giả.
    expect(dan).toContain('[Khách gửi ảnh');
  });

  it('câu đưa vào LLM giữ NGUYÊN VẸN nội dung ảnh, không bị cắt', async () => {
    const goi: Array<{ messages: Array<{ content: string }> }> = [];
    const g: ToolAwareGenerate = async (a) => {
      goi.push(a as { messages: Array<{ content: string }> });
      return { text: '', stopReason: 'tool_use', raw: null, usage, toolCalls: [{ id: 't', name: 'ghi_slot', input: {} }] };
    };

    await trichSlot(g, CAU_23_22, null);

    const cauVao = String(goi[0].messages[0].content);
    expect(cauVao).toContain('P10 full out: 10.000 tấm');
    expect(cauVao).toContain('P5 full out: 1.460 tấm');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CA THẬT 23:22 — chế NHẬP HÀNG.
describe('ca thật 23:22 11/08 — ảnh danh sách hàng + "tạo phiếu nhập"', () => {
  it('KHÔNG hỏi lại "nhập những hàng gì" — hàng đã có trong ảnh', async () => {
    const { goi, tinGui } = dungMay();

    await goi(CAU_23_22);

    const tin = tinGui.join('\n');
    expect(tin).not.toContain('nhập những hàng gì');
  });

  it('lượt "1" chọn NCC → phiếu nhập ra ngay, không quay lại hỏi hàng', async () => {
    const { goi, tinGui } = dungMay();

    await goi(CAU_23_22);
    await goi('1');

    const tin = tinGui.join('\n');
    expect(tin).not.toContain('nhập những hàng gì');
    // Phải nhắc được đúng hàng trong ảnh.
    expect(tin).toMatch(/P10 full out|P5 full out/);
  });

  it('phiếu nhập ghi đúng SỐ LƯỢNG đọc từ ảnh (10.000 và 1.460)', async () => {
    const { goi, odoo } = dungMay();

    await goi(CAU_23_22);
    await goi('1');

    const create = odoo.execute.mock.calls.find(
      (c) => c[0] === 'purchase.order' && c[1] === 'create');
    expect(create).toBeTruthy();
    const vals = (create![2] as unknown[])[0] as Record<string, unknown>;
    expect(vals.partner_id).toBe(314);
    const dong = (vals.order_line as Array<[number, number, Record<string, unknown>]>)
      .map((l) => l[2]);
    const sl = dong.map((d) => d.product_qty).sort((a, b) => Number(a) - Number(b));
    expect(sl).toEqual([1460, 10000]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Nội dung ảnh phải tới máy gom đơn ở CẢ BA chế — không chỉ chế nhập.
describe('nội dung ảnh vào được cả 3 chế của máy gom đơn', () => {
  it('chế LÊN ĐƠN: ảnh danh sách hàng + "lên đơn cho..." → có dòng hàng', async () => {
    const cau = `@bot lên đơn cho Trung Quốc giúp em\n[Khách gửi ảnh, nội dung trong ảnh: ${NOI_DUNG_ANH}]`;
    const { goi, tinGui } = dungMay('c-len');

    await goi(cau);

    const tin = tinGui.join('\n');
    expect(tin).not.toContain('cần lên hàng gì');
    expect(tin).toMatch(/P10 full out|P5 full out/);
  });

  it('chế SỬA ĐƠN: ảnh danh sách hàng + "sửa đơn" → có dòng hàng, không hỏi sửa gì', async () => {
    const cau = `@bot sửa đơn thêm hàng này\n[Khách gửi ảnh, nội dung trong ảnh: ${NOI_DUNG_ANH}]`;
    const { goi, tinGui } = dungMay('c-sua');

    await goi(cau);

    const tin = tinGui.join('\n');
    expect(tin).not.toMatch(/sửa gì ạ\?/);
  });

  it('chế NHẬP: ảnh + lệnh → phiên vào đúng chế nhập, không thành đơn bán', async () => {
    const { goi, odoo } = dungMay('c-nhap2');

    await goi(CAU_23_22);
    await goi('1');

    // Tuyệt đối không được tạo sale.order cho một lệnh nhập hàng.
    const taoBan = odoo.execute.mock.calls.filter(
      (c) => c[0] === 'sale.order' && c[1] === 'create');
    expect(taoBan).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. ẢNH GỬI KHI PHIÊN ĐANG MỞ — ca liên quan, chưa từng đo.
//
// Ca thật 23:22 thì ảnh đến lúc CHƯA có phiên. Nhưng nhân viên hay làm ngược:
// gõ lệnh trước ("tạo phiếu nhập của Trung Quốc"), bot hỏi hàng, rồi họ GỬI ẢNH
// danh sách hàng để trả lời. Nội dung ảnh phải đắp được vào phiên đang mở.
describe('ảnh bổ sung giữa phiên đang mở', () => {
  it('bot hỏi hàng → NV gửi ẢNH danh sách → đắp vào phiên, không hỏi lại', async () => {
    const { goi, tinGui } = dungMay('c-giua-phien');

    // Lượt 1: lệnh nhập không kèm hàng → bot hỏi NCC (rồi hàng).
    await goi('@bot tạo phiếu nhập hàng của nhà cung cấp Trung Quốc');
    await goi('1');
    expect(tinGui.join('\n')).toContain('nhập những hàng gì');

    // Lượt 3: NV gửi ẢNH danh sách hàng (không kèm lời nhắn nào).
    const soTinTruoc = tinGui.length;
    await goi(`[Khách gửi ảnh, nội dung trong ảnh: ${NOI_DUNG_ANH}]`);

    const tinMoi = tinGui.slice(soTinTruoc).join('\n');
    expect(tinMoi).not.toContain('nhập những hàng gì');
    expect(tinMoi).toMatch(/P10 full out|P5 full out/);
  });

  it('ảnh giữa phiên KHÔNG bị coi là digression (ngoaiLe) và nhường agent thường', async () => {
    const { goi } = dungMay('c-giua-phien-2');

    await goi('@bot tạo phiếu nhập hàng của nhà cung cấp Trung Quốc');
    await goi('1');

    // Máy PHẢI nhận việc — trả false là rơi xuống agent tự do, mất phiên.
    const nhan = await goi(`[Khách gửi ảnh, nội dung trong ảnh: ${NOI_DUNG_ANH}]`);
    expect(nhan).toBe(true);
  });

  // HÀNG RÀO CODE, không chỉ hàng rào prompt. Lời dặn dạy model đọc khối ảnh,
  // nhưng model vẫn trả `ngoaiLe=true` được — nó rất hay làm vậy với chuỗi dài
  // và nhiễu (ca 15:06 11/08 đã trả giá đúng kiểu này). Phiên đang mở + tin có
  // khối ảnh thì "không liên quan đơn hàng" là câu trả lời TỰ MÂU THUẪN: nhân
  // viên gửi ảnh vào GIỮA việc đang gom chính là đang nói tiếp việc đó.
  it('model trả ngoaiLe=true cho tin có khối ảnh giữa phiên → máy VẪN cầm lái', async () => {
    const odoo = fakeOdoo();
    const db = fakeDb();
    const tinGui: string[] = [];
    // LLM "bướng": luôn phủ quyết bằng ngoaiLe, kể cả khi có khối ảnh.
    const buong: ToolAwareGenerate = async (a) => {
      const nd = String(a.messages[0].content);
      const input: Record<string, unknown> = nd.includes('[Khách gửi ảnh')
        ? { ngoaiLe: true }
        : { nhapHang: true, khach: 'Trung Quốc' };
      return { text: '', stopReason: 'tool_use', raw: null, usage, toolCalls: [{ id: 't', name: 'ghi_slot', input }] };
    };
    const deps: GomDonDeps = {
      prisma: db as never, odoo: odoo as never, generate: buong,
      anhClient: null, odooUrl: 'https://odoo.example.com',
      guiTin: async (t) => { tinGui.push(t); },
      guiAnhHoaDon: async () => {}, ghiLog: () => {},
    };
    let seq = 0;
    const goi = (cau: string) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId: 'c-buong', seq: ++seq, cau, senderUid: 'uid-quoc',
    });

    await goi('@bot tạo phiếu nhập hàng của nhà cung cấp Trung Quốc');
    await goi('1');

    const nhan = await goi(`[Khách gửi ảnh, nội dung trong ảnh: ${NOI_DUNG_ANH}]`);
    expect(nhan).toBe(true);
  });

  // Mặt còn lại của cùng hàng rào: KHÔNG có phiên thì ảnh vu vơ (ảnh chuyển
  // khoản, ảnh cái ghế) vẫn phải nhường agent thường như cũ. Hàng rào chỉ nới
  // đúng ca "đang gom dở", không biến mọi ảnh thành lệnh lên đơn.
  it('KHÔNG có phiên + ảnh vu vơ (model nói ngoaiLe) → vẫn nhường agent thường', async () => {
    const odoo = fakeOdoo();
    const db = fakeDb();
    const deps: GomDonDeps = {
      prisma: db as never, odoo: odoo as never,
      generate: async () => ({
        text: '', stopReason: 'tool_use', raw: null, usage,
        toolCalls: [{ id: 't', name: 'ghi_slot', input: { ngoaiLe: true } }],
      }),
      anhClient: null, odooUrl: 'https://odoo.example.com',
      guiTin: async () => {}, guiAnhHoaDon: async () => {}, ghiLog: () => {},
    };

    const nhan = await xuLyGomDon(deps, {
      orgId: 'o1', conversationId: 'c-anh-vu-vo', seq: 1,
      cau: '[Khách gửi ảnh, nội dung trong ảnh: một cái ghế gỗ màu nâu]',
      senderUid: 'uid-quoc',
    });

    expect(nhan).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. ĐỪNG PHÁ CÁI ĐANG ĐÚNG — khối `[Trả lời tin: ...]` vẫn phải bị cắt.
//
// Cả hai đều là "khối vuông" trong câu, nhưng vai trò NGƯỢC nhau:
//   [Trả lời tin: "..."]  → NGỮ CẢNH bot tự chèn, phải cắt khỏi câu CHỌN
//                           (bug 23:14 07/08: quote danh sách rồi gõ "5").
//   [Khách gửi ảnh: ...]  → NỘI DUNG THẬT nhân viên gửi, phải GIỮ.
describe('khối [Trả lời tin] vẫn bị cắt như cũ (đừng phá cái đang đúng)', () => {
  it('quote danh sách khách rồi gõ "1" → vẫn map được lựa chọn', async () => {
    const { goi, tinGui } = dungMay('c-quote');

    await goi(CAU_23_22);
    // NV quote lại tin danh sách của bot rồi gõ "1" — đúng thao tác 23:14 07/08.
    await goi('[Trả lời tin: "Có 2 nhà cung cấp tên \\"Trung Quốc\\": 1) Trung Quốc · NCC000001"] 1');

    // Map được thì không còn câu "chưa khớp được".
    expect(tinGui.join('\n')).not.toContain('chưa khớp được');
  });

  it('câu vừa có quote VỪA có khối ảnh → cắt quote, GIỮ ảnh', async () => {
    const { goi, tinGui } = dungMay('c-ca-hai');

    const cau =
      '[Trả lời tin: "Anh/chị nhập những hàng gì ạ?"] tạo phiếu nhập hàng nhà cung cấp Trung Quốc\n' +
      `[Khách gửi ảnh, nội dung trong ảnh: ${NOI_DUNG_ANH}]`;
    await goi(cau);
    await goi('1');

    const tin = tinGui.join('\n');
    expect(tin).not.toContain('nhập những hàng gì');
    expect(tin).toMatch(/P10 full out|P5 full out/);
  });
});
