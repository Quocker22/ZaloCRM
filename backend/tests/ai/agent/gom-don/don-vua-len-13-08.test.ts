// SPDX-License-Identifier: AGPL-3.0-or-later
// REPLAY CA THẬT — nhóm private 1, 06:05-06:29 ngày 13/08/2026.
//
// Chuỗi ba cái hỏng nối nhau, kết cục là ĐƠN TRÙNG S13849 + KHÁCH TRÙNG "Dương":
//
//   06:05:09  NV : "khách hàng mới, a dương quảng ninh, 3000 3B 6214 trắng ấm
//                   x 1800đ, 10 cái nguồn 12v400w DF x180K, VAT8%"
//   06:05:47  Bot: lên S13848 với "3 bóng 6214 trắng (thanh)"  ← SAI MÀU, vì
//                  alias học sai lúc 03:02 ("3b 6214 trắng ấm"→trắng) TỰ CHỐT
//                  IM LẶNG — không hỏi, không nói đã thay tên.
//   06:21:12  NV : "6214 trắng ấm mà ???"
//   06:26:42  NV : "xuất lại báo giá cho đúng đi"
//   06:28:12  Bot: dán NGUYÊN output tool "id=452 | … LƯU Ý: … CHUYỂN SALE
//                  NGAY," ra nhóm (đường hết-giờ trả raw)
//   06:28:39  NV : "giá 1800 đó"
//   06:28:40  Bot: "Đơn này lên cho khách nào ạ?"  ← MẤT SẠCH NGỮ CẢNH: phiên
//                  đã xoá sau khi S13848 lên, câu tham chiếu sửa bị hiểu thành
//                  lệnh LÊN ĐƠN MỚI tay trắng.
//   06:29:58  Bot: đẻ S13849 (3 dòng lộn xộn) cho khách MỚI TRÙNG "Dương".
//
// Ba hàng rào (đều ở CODE):
//   1. `xungDotBienThe` — alias/khớp thẳng bị chặn khi từ khoá nói "ấm" mà tên
//      SP không có "ấm": rơi xuống đường tra thường để NV chọn (lựa chọn mới
//      đè alias sai — tự lành).
//   2. Dấu `daXong` (đơn vừa lên) + `NHAN_THAM_CHIEU_SUA` — 15 phút sau khi
//      đơn lên, câu "giá … đó"/"xuất lại"/"sai rồi" ép chế SỬA đúng mã đơn đó,
//      không mở phiên lên-đơn-mới, không hỏi "khách nào ạ".
//   3. `boChiDanNoiBo` — đường hết-giờ bóc "LƯU Ý: …" + nhãn "id=" trước khi
//      output tool đi thẳng ra Zalo.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import { xungDotBienThe } from '../../../../src/modules/ai/odoo/tools/tra-san-pham.js';
import { tomTatDoDang, boChiDanNoiBo } from '../../../../src/modules/ai/agent/noi-zalo/ngan-sach.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function fakeGenerate(slots: Record<string, unknown>[]): ToolAwareGenerate {
  let i = 0;
  return async () => ({
    text: '', stopReason: 'tool_use', raw: null, usage,
    toolCalls: [{ id: 't', name: 'ghi_slot', input: slots[Math.min(i++, slots.length - 1)] }],
  });
}

const AM = { id: 452, name: 'Led 3 bóng atx 6214 Ấm (bóng)', default_code: 'SP000169', list_price: 2000, uom_id: [1, 'Cái'] };
const TRANG = { id: 1600, name: '3 bóng 6214 trắng (thanh)', default_code: 'SP001600', list_price: 2000, uom_id: [1, 'Cái'] };
const DF = { id: 411, name: 'Nguồn DF-12V400W (cái)', default_code: 'DF12V400W', list_price: 180000, uom_id: [1, 'Cái'] };

/** Odoo giả theo ca thật: khách "Dương", các SP 6214 + nguồn DF, đơn nháp ghi được. */
function fakeOdoo(sanPham: Array<typeof AM>) {
  const donDaGhi = new Map<string, { id: number; name: string }>();
  let idKe = 26765; // S13848 = id 26765 trong ca thật
  const odoo = {
    searchRead: vi.fn(async (model: string, domain: unknown[], fields?: unknown) => {
      const d = JSON.stringify(domain);
      if (model === 'res.partner') return [{ id: 3944, name: 'Dương', ref: 'KH003944', phone: false }];
      if (model === 'product.product') {
        if (JSON.stringify(fields ?? []).includes('incokit_stock_breakdown')) {
          return sanPham.map((p) => ({ id: p.id, name: p.name, incokit_stock_breakdown: [] }));
        }
        // Tra theo id (đường alias / validate của tao_don) → trả đúng SP đó.
        const mid = (domain as unknown[]).find(
          (x): x is [string, string, number | number[]] => Array.isArray(x) && x[0] === 'id');
        if (mid) {
          const ids = Array.isArray(mid[2]) ? (mid[2] as number[]).map(Number) : [Number(mid[2])];
          return sanPham.filter((p) => ids.includes(p.id));
        }
        const g = (domain as unknown[]).find(
          (x): x is [string, string, number] => Array.isArray(x) && x[0] === 'list_price');
        if (g && g[1] === '<=') return [];
        return sanPham;
      }
      if (model === 'sale.order') {
        if (d.includes('client_order_ref')) {
          const m = d.match(/zalo:[^"]+/);
          const cu = m ? donDaGhi.get(m[0]) : undefined;
          return cu ? [{ ...cu, state: 'draft', amount_total: 1800000, client_order_ref: m![0] }] : [];
        }
        // Tra theo name= (đường sửa với mã đơn) hoặc đọc lại theo id.
        const mten = (domain as unknown[]).find(
          (x): x is [string, string, string] => Array.isArray(x) && x[0] === 'name');
        if (mten) {
          const daCo = [...donDaGhi.values()].find((v) => v.name === mten[2]);
          return daCo ? [{ ...daCo, state: 'draft', amount_total: 1800000 }] : [];
        }
        const mid = (domain as unknown[]).find(
          (x): x is [string, string, number] => Array.isArray(x) && x[0] === 'id');
        const id = mid ? Number(mid[2]) : idKe - 1;
        return [{ id, name: `S${13848 + (id - 26765)}`, state: 'draft', amount_total: 1800000, amount_untaxed: 1800000 }];
      }
      return [];
    }),
    execute: vi.fn(async (model: string, method: string, args?: unknown) => {
      if (model === 'sale.order' && method === 'create') {
        const vals = (args as Array<Record<string, unknown>>)[0];
        const id = idKe++;
        donDaGhi.set(String(vals.client_order_ref ?? ''), { id, name: `S${13848 + (id - 26765)}` });
        return id;
      }
      return idKe;
    }),
  };
  return odoo;
}

function fakeDb() {
  const rows = new Map<string, { orgId: string; conversationId: string; slots: unknown; hetHan: Date }>();
  return {
    phienGomDon: {
      findUnique: async ({ where }: { where: { conversationId: string } }) =>
        rows.get(where.conversationId) ?? null,
      upsert: async ({ where, create, update }: {
        where: { conversationId: string }; create: never;
        update: { slots: unknown; hetHan: Date };
      }) => {
        const cu = rows.get(where.conversationId);
        rows.set(where.conversationId, cu ? { ...cu, ...update } : create);
        return create;
      },
      deleteMany: async ({ where }: { where: { conversationId: string } }) => {
        rows.delete(where.conversationId); return { count: 1 };
      },
    },
  };
}

function dungMay(input: {
  slots: Record<string, unknown>[];
  sanPham?: Array<typeof AM>;
  aliasCua?: Record<string, number>;
  conversationId?: string;
}) {
  const odoo = fakeOdoo(input.sanPham ?? [AM, TRANG, DF]);
  const tinGui: string[] = [];
  const deps: GomDonDeps = {
    prisma: fakeDb() as never, odoo: odoo as never, generate: fakeGenerate(input.slots),
    anhClient: null, odooUrl: 'https://odoo.example.com',
    ...(input.aliasCua
      ? { traAliasSp: async (tuKhoa: string) => input.aliasCua![tuKhoa.toLowerCase()] ?? null }
      : {}),
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {}, ghiLog: () => {},
  };
  const conversationId = input.conversationId ?? 'c-private1-13-08';
  return {
    goi: (cau: string, seq: number) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId, seq, cau, senderUid: 'uid-nv',
    }),
    tinGui, odoo,
  };
}

const soDonDaTao = (odoo: ReturnType<typeof fakeOdoo>): number =>
  odoo.execute.mock.calls.filter(
    (c) => String(c[0]) === 'sale.order' && String(c[1]) === 'create',
  ).length;

describe('xungDotBienThe — từ biến thể trong từ khoá phải có mặt trong tên SP', () => {
  it('"trắng ấm" là màu ẤM: xung khắc với SP trắng, hoà hợp với SP Ấm', () => {
    expect(xungDotBienThe('3b 6214 trắng ấm', '3 bóng 6214 trắng (thanh)')).toBe(true);
    expect(xungDotBienThe('3b 6214 trắng ấm', 'Led 3 bóng atx 6214 Ấm (bóng)')).toBe(false);
  });
  it('không có từ biến thể → không bao giờ chặn (alias kiểu tên-lệch-catalog giữ nguyên)', () => {
    expect(xungDotBienThe('led hắt 3 bóng 6313', '3 Bóng Saso 6313')).toBe(false);
  });
  it('trong nhà vs ngoài trời là hai hàng khác nhau', () => {
    expect(xungDotBienThe('nguồn trong nhà 12v400w', 'Nguồn ATX Ngoài Trời 12V400W')).toBe(true);
  });
});

describe('CA 06:05 13/08 — alias học sai không được TỰ CHỐT im lặng sai màu', () => {
  it('alias "trắng ấm"→SP trắng bị chặn: máy hỏi chọn, KHÔNG lên đơn sai màu', async () => {
    const { goi, tinGui, odoo } = dungMay({
      slots: [{
        lenDon: true, khachMoi: { ten: 'Dương Quảng Ninh' },
        dong: [{ sp: '3B 6214 trắng ấm', sl: 3000, gia: 1800 }],
      }],
      // Đúng vết prod: bảng alias có sẵn dòng độc "3b 6214 trắng ấm" → id 1600 (trắng).
      aliasCua: { '3b 6214 trắng ấm': TRANG.id },
      sanPham: [AM, TRANG],
    });

    await goi('khách hàng mới, a dương quảng ninh, 3000 3B 6214 trắng ấm x 1800đ', 2001);

    // Trước vá: alias tự chốt → đơn S13848 với SP TRẮNG ra luôn lượt này.
    expect(soDonDaTao(odoo)).toBe(0);
    // Máy phải mở miệng hỏi chọn giữa các loại 6214 (tra thường ra 2 ứng viên).
    expect(tinGui.join('\n')).toMatch(/loại|chọn/i);
  });
});

describe('CA 06:28 13/08 — đơn vừa lên xong, câu tham chiếu sửa KHÔNG được hỏi "khách nào"', () => {
  it('"giá 1800 đó" ngay sau đơn → chế SỬA đúng đơn đó, không mở phiên mới', async () => {
    const { goi, tinGui, odoo } = dungMay({
      slots: [
        { lenDon: true, khach: 'dương', dong: [{ sp: 'nguồn df-12v400w', sl: 10, gia: 180000 }] },
        // Model prod 06:28 bật lenDon cho câu này — hàng rào code phải ĐÈ nó.
        { lenDon: true, dong: [{ sp: 'led 3 bóng atx 6214 ấm', gia: 1800 }] },
      ],
      sanPham: [AM, DF],
    });

    await goi('lên đơn cho Dương 10 cái nguồn df-12v400w giá 180k', 3001);
    expect(soDonDaTao(odoo)).toBe(1); // S13848 đã lên — phiên chết, để lại dấu

    const nhan = await goi('giá 1800 đó', 3002);

    expect(nhan).toBe(true); // vẫn việc của máy — không rơi xuống agent tự do
    const sau = tinGui.slice(1).join('\n');
    // CÁI ĐỎ TRƯỚC VÁ: "Đơn này lên cho khách nào ạ?"
    expect(sau).not.toMatch(/khách nào/i);
    // Và không đẻ thêm đơn mới (S13849 của ca thật).
    expect(soDonDaTao(odoo)).toBe(1);
  });

  it('"xuất lại báo giá cho đúng đi" sau đơn → máy nhận việc ở chế sửa, không hỏi khách', async () => {
    const { goi, tinGui } = dungMay({
      slots: [
        { lenDon: true, khach: 'dương', dong: [{ sp: 'nguồn df-12v400w', sl: 10, gia: 180000 }] },
        { ngoaiLe: true }, // model prod coi câu này là chuyện ngoài lề → trước vá rơi xuống agent
      ],
      sanPham: [AM, DF],
    });

    await goi('lên đơn cho Dương 10 cái nguồn df-12v400w giá 180k', 4001);
    const nhan = await goi('xuất lại báo giá cho đúng đi', 4002);

    expect(nhan).toBe(true);
    expect(tinGui.slice(1).join('\n')).not.toMatch(/khách nào/i);
  });

  it('KHÔNG có đơn vừa lên → "giá 1800 đó" ngoài lề vẫn nhường agent như cũ', async () => {
    const { goi } = dungMay({ slots: [{ ngoaiLe: true }], sanPham: [AM] });
    expect(await goi('giá 1800 đó', 5001)).toBe(false);
  });
});

describe('CA 06:28:12 13/08 — đường hết-giờ không dán lời-dặn-model ra Zalo', () => {
  const outputTool =
    'id=452 | Led 3 bóng atx 6214 Ấm (bóng) [SP000169] | CHƯA CÓ GIÁ trong hệ thống\n' +
    'LƯU Ý: cả 1 sản phẩm tìm được đều chưa nhập giá — KHÔNG báo 0đ. Hãy thử LẠI ĐÚNG MỘT LẦN ' +
    'với từ khoá rộng hơn (bỏ bớt chữ) để tìm sản phẩm tương tự CÓ giá. Nếu lần đó vẫn không ra ' +
    'SP có giá phù hợp thì CHUYỂN SALE NGAY,';

  it('bóc "LƯU Ý:…" và nhãn id= — giữ phần dữ liệu người đọc được', () => {
    const ra = boChiDanNoiBo(outputTool);
    expect(ra).not.toContain('LƯU Ý');
    expect(ra).not.toContain('CHUYỂN SALE');
    expect(ra).not.toContain('id=');
    expect(ra).toContain('Led 3 bóng atx 6214 Ấm');
  });

  it('tomTatDoDang áp cùng bộ lọc; output chỉ toàn lời dặn → null (nói câu chờ chung)', () => {
    const tom = tomTatDoDang([{ toolName: 'tra_san_pham', output: outputTool, thanhCong: true }]);
    expect(tom).not.toBeNull();
    expect(tom!).not.toContain('LƯU Ý');
    expect(tomTatDoDang([{ toolName: 't', output: 'LƯU Ý: chỉ dặn model thôi', thanhCong: true }])).toBeNull();
  });
});

describe('CA 22:30-22:33 14/08 — sửa GIÁ bằng code, máy phải biết dòng của đơn', () => {
  const fakeOdooCoDong = () => {
    const odoo = fakeOdoo([AM, DF]);
    const searchRead0 = odoo.searchRead.getMockImplementation()!;
    odoo.searchRead.mockImplementation(async (model: string, domain: unknown[], fields?: unknown) => {
      if (model === 'sale.order.line') {
        return [{ product_id: [411, 'Nguồn DF-12V400W (cái)'], product_uom_qty: 10, price_unit: 180000 }];
      }
      return searchRead0(model, domain, fields);
    });
    return odoo;
  };

  const lenDonRoi = async (slots: Record<string, unknown>[], conversationId: string) => {
    const odoo = fakeOdooCoDong();
    const tinGui: string[] = [];
    const deps: GomDonDeps = {
      prisma: fakeDb() as never, odoo: odoo as never, generate: fakeGenerate(slots),
      anhClient: null, odooUrl: 'https://odoo.example.com',
      guiTin: async (t) => { tinGui.push(t); }, guiAnhHoaDon: async () => {}, ghiLog: () => {},
    };
    const goi = (cau: string, seq: number) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId, seq, cau, senderUid: 'e2e',
    });
    await goi('lên đơn cho Dương 10 cái nguồn df-12v400w giá 180k', 7001);
    return { goi, tinGui, odoo, soTinSauDon: tinGui.length };
  };

  const suaDaGoi = (odoo: ReturnType<typeof fakeOdoo>) =>
    odoo.execute.mock.calls.filter((c) => String(c[1]) === 'write' || String(c[1]).includes('sua')).length
    + odoo.execute.mock.calls.filter((c) => String(c[0]) === 'sale.order.line').length;

  it('"giá 175k đó" sau đơn 1 dòng → áp giá cho chính dòng đó, SL giữ nguyên, KHÔNG hỏi gì', async () => {
    const { goi, tinGui, soTinSauDon } = await lenDonRoi(
      [{ lenDon: true, khach: 'dương', dong: [{ sp: 'nguồn df-12v400w', sl: 10, gia: 180000 }] }],
      'c-sua-gia-1dong',
    );
    const nhan = await goi('giá 175k đó', 7002);
    expect(nhan).toBe(true);
    const sau = tinGui.slice(soTinSauDon).join('\n');
    // CÁI ĐỎ CŨ: "Đơn S13858 sửa gì ạ?" rồi kẹt. Giờ phải ra kết quả sửa
    // (hoặc ít nhất KHÔNG hỏi lại "sửa gì"/"khách nào").
    expect(sau).not.toMatch(/sửa gì ạ|khách nào/i);
    expect(sau).toMatch(/175\.000|Đã sửa/i);
  });

  it('"sửa giá nguồn á" (không kèm số) → hỏi đúng MỘT con số, rồi "175k" là sửa xong', async () => {
    const { goi, tinGui, soTinSauDon } = await lenDonRoi(
      [{ lenDon: true, khach: 'dương', dong: [{ sp: 'nguồn df-12v400w', sl: 10, gia: 180000 }] }],
      'c-sua-gia-hoi-so',
    );
    await goi('sửa giá nguồn á', 7003);
    const hoi = tinGui.slice(soTinSauDon).join('\n');
    // CÁI ĐỎ CŨ: "Em vẫn chưa khớp được ... gõ SĐT hoặc mã KH của khách".
    expect(hoi).not.toMatch(/SĐT hoặc mã KH|khách mới/i);
    expect(hoi).toMatch(/bao nhiêu/i);

    const truoc = tinGui.length;
    await goi('175k', 7004);
    const xong = tinGui.slice(truoc).join('\n');
    expect(xong).toMatch(/175\.000|Đã sửa/i);
    expect(xong).not.toMatch(/khách nào|sửa gì ạ/i);
  });
});

describe('CA 22:35 16/08 — PHIẾU NHẬP cũng sửa được qua chat như đơn bán', () => {
  const fakeOdooMua = () => {
    const odoo = fakeOdoo([DF]);
    const goc = odoo.searchRead.getMockImplementation()!;
    const donMua = { id: 14589, name: 'P04525', state: 'draft', amount_total: 0 };
    odoo.searchRead.mockImplementation(async (model: string, domain: unknown[], fields?: unknown) => {
      const d = JSON.stringify(domain);
      if (model === 'purchase.order') {
        if (d.includes('origin') || d.includes('P04525') || d.includes('14589')) return [donMua];
        return [donMua];
      }
      if (model === 'purchase.order.line') {
        return [{ id: 71, product_id: [500, 'Nguồn NB Ngoài Trời 12V100W (cái)'], product_qty: 1000, price_unit: 0 }];
      }
      return goc(model, domain, fields);
    });
    const executeGoc = odoo.execute.getMockImplementation()!;
    odoo.execute.mockImplementation(async (model: string, method: string, args?: unknown, kw?: unknown) => {
      if (model === 'purchase.order.line' && method === 'write') {
        donMua.amount_total = 78000 * 1000; return true;
      }
      return executeGoc(model, method, args, kw);
    });
    return odoo;
  };

  it('marker phiếu nhập (P…) + "giá nhập 78k đó" → sửa GIÁ NHẬP dòng duy nhất, SL giữ 1000', async () => {
    const odoo = fakeOdooMua();
    const tinGui: string[] = [];
    const db = fakeDb();
    // marker đơn-vừa-lên là PHIẾU NHẬP
    await db.phienGomDon.upsert({
      where: { conversationId: 'c-phieu-nhap' },
      create: { orgId: 'o1', conversationId: 'c-phieu-nhap',
        slots: { khachTuKhoa: null, dong: [], daXong: { maDon: 'P04525', tenKhach: 'Trung Quốc' } },
        hetHan: new Date(Date.now() + 600000) } as never,
      update: {} as never,
    });
    const deps: GomDonDeps = {
      prisma: db as never, odoo: odoo as never, generate: fakeGenerate([{}]),
      anhClient: null, odooUrl: 'https://odoo.example.com',
      guiTin: async (t) => { tinGui.push(t); }, guiAnhHoaDon: async () => {}, ghiLog: () => {},
    };
    const nhan = await xuLyGomDon(deps, {
      orgId: 'o1', conversationId: 'c-phieu-nhap', seq: 8001, cau: 'giá nhập 78k đó', senderUid: 'nv',
    });
    expect(nhan).toBe(true);
    const ra = tinGui.join('\n');
    expect(ra).toContain('phiếu nhập P04525');
    expect(ra).not.toMatch(/khách nào|vào link điền giá/i);
    // dòng purchase được write với giá nhập 78000, SL giữ nguyên 1000
    const wr = odoo.execute.mock.calls.find((c) => c[0] === 'purchase.order.line' && c[1] === 'write');
    expect(wr).toBeTruthy();
    expect(JSON.stringify(wr)).toContain('78000');
    expect(JSON.stringify(wr)).toContain('1000');
  });

  it('"sửa phiếu nhập P04525 …" — regex sửa bắt được chữ PHIẾU (trước đây chỉ "đơn")', async () => {
    const { xuLyGomDon: _x } = await import('../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js');
    // đủ để khoá: câu vào máy không bị trả false ngay cửa (laLenhSua nhận)
    const odoo = fakeOdooMua();
    const tinGui: string[] = [];
    const deps: GomDonDeps = {
      prisma: fakeDb() as never, odoo: odoo as never, generate: fakeGenerate([{ dong: [{ sp: 'nguồn nb', sl: 500 }] }]),
      anhClient: null, odooUrl: 'https://odoo.example.com',
      guiTin: async (t) => { tinGui.push(t); }, guiAnhHoaDon: async () => {}, ghiLog: () => {},
    };
    const nhan = await _x(deps, {
      orgId: 'o1', conversationId: 'c-sua-phieu', seq: 8101,
      cau: 'sửa phiếu nhập P04525 nguồn nb thành 500 cái', senderUid: 'nv',
    });
    expect(nhan).toBe(true);
    expect(tinGui.join('\n')).toMatch(/phiếu nhập|P04525/i);
  });
});

describe('CA 23:12-23:14 16/08 — SL nằm trong ảnh thì code ghép, không hỏi lại; ảnh ghép lại không đẻ nhóm trùng', () => {
  const P10FO = { id: 900, name: 'P10 Full Out 260626 LLR (tấm)', default_code: 'P10FO', list_price: 175000, uom_id: [1, 'Tấm'] };
  const NGUON5V = { id: 901, name: '5V 60A mỏng ATX (cái)', default_code: '5V60A', list_price: 220000, uom_id: [1, 'Cái'] };
  const KHOI_ANH = '[Khách gửi ảnh, nội dung trong ảnh: P10 Full Out 260626: 10.000 tấm\n5V 60A mỏng: 1.131 cái] lên đơn cho Dương';

  it('model trích RƠI hết SL → code điền từ khối ảnh, lên đơn thẳng không hỏi "số lượng"', async () => {
    const { goi, tinGui, odoo } = dungMay({
      // mô phỏng đúng bệnh prod: model trả dòng KHÔNG sl dù ảnh ghi rõ
      slots: [{ lenDon: true, khach: 'dương', dong: [{ sp: 'P10 Full Out 260626' }, { sp: '5V 60A mỏng' }] }],
      sanPham: [P10FO, NGUON5V],
      conversationId: 'c-sl-tu-anh',
    });
    await goi(KHOI_ANH, 9001);
    const ra = tinGui.join('\n');
    expect(ra).not.toMatch(/số lượng|mấy cái|bao nhiêu/i);
    const taoDon = odoo.execute.mock.calls.find((c) => c[0] === 'sale.order' && c[1] === 'create');
    expect(taoDon).toBeTruthy();
    const vals = JSON.stringify(taoDon);
    expect(vals).toContain('10000');
    expect(vals).toContain('1131');
  });

  it('ảnh bị ghép lại lượt sau → dòng trích mới trùng-lồng dòng đang có bị bỏ, không đẻ nhóm đôi', async () => {
    const { goi, tinGui } = dungMay({
      slots: [
        // lượt 1: một dòng chờ SL (model rơi cả sl lẫn không có trong ảnh giả này)
        { lenDon: true, khach: 'dương', dong: [{ sp: 'P10 Full Out 260626' }] },
        // lượt 2 (ảnh ghép lại): model trích lại tên NGẮN HƠN của cùng mặt hàng
        { dong: [{ sp: 'P10 full out' }] },
      ],
      sanPham: [P10FO],
      conversationId: 'c-anh-ghep-lai',
    });
    await goi('[Khách gửi ảnh, nội dung trong ảnh: P10 Full Out 260626] lên đơn cho Dương', 9101);
    const truoc = tinGui.length;
    await goi('[Khách gửi ảnh, nội dung trong ảnh: P10 Full Out 260626: 10.000 tấm] số lượng trong hình có', 9102);
    const sau = tinGui.slice(truoc).join('\n');
    // Không được hỏi chọn lại nhóm mới cho cùng mặt hàng; SL 10.000 phải vào từ ảnh.
    expect(sau).not.toMatch(/có \d+ loại/i);
    expect(sau).toMatch(/10\.000|Đã lên đơn|Đơn cho/i);
  });
});

describe('CA 00:28 17/08 — "<tên hàng> giá nhập <số> nhé" phải SỬA, không bịa NCC "NB"', () => {
  it('mẫu 2 phanTichCauSuaGia: tên đứng trước, giá nhập ở giữa', async () => {
    const { phanTichCauSuaGia } = await import('../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js');
    expect(phanTichCauSuaGia('nguon nb ngoai troi 12v400w gia nhap 20099d nhe'))
      .toEqual({ ten: 'nguon nb ngoai troi 12v400w', gia: 20099 });
    expect(phanTichCauSuaGia('cap 16 soi nho gia 170k')).toEqual({ ten: 'cap 16 soi nho', gia: 170000 });
    // câu thường không dính oan
    expect(phanTichCauSuaGia('len don cho anh ha 10 cai nguon nb')).toBeNull();
  });

  it('marker phiếu vừa lên + câu đó → sửa GIÁ NHẬP đúng dòng, không hỏi NCC', async () => {
    const odoo = fakeOdoo([DF]);
    const goc = odoo.searchRead.getMockImplementation()!;
    const donMua = { id: 14595, name: 'P04531', state: 'draft', amount_total: 0 };
    odoo.searchRead.mockImplementation(async (model: string, domain: unknown[], fields?: unknown) => {
      if (model === 'purchase.order') return [donMua];
      if (model === 'purchase.order.line') {
        return [{ id: 91, product_id: [500, 'Nguồn NB Ngoài Trời 12V400W (cái)'], product_qty: 3030, price_unit: 0 }];
      }
      return goc(model, domain, fields);
    });
    const tinGui: string[] = [];
    const db = fakeDb();
    await db.phienGomDon.upsert({
      where: { conversationId: 'c-gia-nhap-ten-truoc' },
      create: { orgId: 'o1', conversationId: 'c-gia-nhap-ten-truoc',
        slots: { khachTuKhoa: null, dong: [], daXong: { maDon: 'P04531', tenKhach: 'Trung Quốc' } },
        hetHan: new Date(Date.now() + 600000) } as never,
      update: {} as never,
    });
    const deps: GomDonDeps = {
      prisma: db as never, odoo: odoo as never, generate: fakeGenerate([{}]),
      anhClient: null, odooUrl: 'https://odoo.example.com',
      guiTin: async (t) => { tinGui.push(t); }, guiAnhHoaDon: async () => {}, ghiLog: () => {},
    };
    const nhan = await xuLyGomDon(deps, {
      orgId: 'o1', conversationId: 'c-gia-nhap-ten-truoc', seq: 8201,
      cau: 'Nguồn NB Ngoài Trời 12V400W giá nhập 20099đ nhé', senderUid: 'nv',
    });
    expect(nhan).toBe(true);
    const ra = tinGui.join('\n');
    expect(ra).not.toMatch(/nhà cung cấp|không tìm thấy/i);
    expect(ra).toContain('phiếu nhập P04531');
    const wr = odoo.execute.mock.calls.find((c) => c[0] === 'purchase.order.line' && c[1] === 'write');
    expect(JSON.stringify(wr)).toContain('20099');
    expect(JSON.stringify(wr)).toContain('3030'); // SL giữ nguyên theo phiếu
  });
});

describe('CA P04528→P04531 — gửi lại cùng ảnh KHÔNG đẻ phiếu trùng nội dung', () => {
  const dungMayMua = () => {
    const odoo = fakeOdoo([DF]);
    const goc = odoo.searchRead.getMockImplementation()!;
    const daGhi: Array<{ id: number; name: string; state: string; khoa: string; lines: Array<{ sp: number; sl: number }> }> = [];
    let idKe = 15000;
    odoo.searchRead.mockImplementation(async (model: string, domain: unknown[], fields?: unknown) => {
      const d = JSON.stringify(domain);
      if (model === 'res.partner') return [{ id: 70, name: 'Trung Quốc', ref: 'NCC000001', phone: false, supplier_rank: 5 }];
      if (model === 'purchase.order') {
        if (d.includes('origin')) {
          // '=' khoá chính xác (idempotency tool) vs 'like' (tìm nháp cùng conv)
          const bang = (domain as unknown[]).find(
            (x): x is [string, string, string] => Array.isArray(x) && x[0] === 'origin');
          const khop = bang?.[1] === '='
            ? daGhi.filter((x) => x.khoa === bang[2])
            : daGhi;
          return khop.map((x) => ({ id: x.id, name: x.name, state: x.state, amount_total: 0 }));
        }
        const mid = (domain as unknown[]).find((x): x is [string, string, number] => Array.isArray(x) && x[0] === 'id');
        if (mid) { const c = daGhi.find((x) => x.id === Number(mid[2])); return c ? [{ id: c.id, name: c.name, state: c.state, amount_total: 0 }] : []; }
        return [];
      }
      if (model === 'purchase.order.line') {
        const mid = (domain as unknown[]).find((x): x is [string, string, number] => Array.isArray(x) && x[0] === 'order_id');
        const c = daGhi.find((x) => x.id === Number(mid?.[2]));
        return (c?.lines ?? []).map((l, i) => ({ id: i + 1, product_id: [l.sp, 'SP'], product_qty: l.sl, price_unit: 0 }));
      }
      return goc(model, domain, fields);
    });
    const execGoc = odoo.execute.getMockImplementation()!;
    odoo.execute.mockImplementation(async (model: string, method: string, args?: unknown, kw?: unknown) => {
      if (model === 'purchase.order' && method === 'create') {
        const vals = (args as Array<Record<string, unknown>>)[0];
        const lines = (vals.order_line as Array<[number, number, Record<string, unknown>]>).map((l) => ({ sp: Number(l[2].product_id), sl: Number(l[2].product_qty) }));
        const id = idKe++;
        daGhi.push({ id, name: `P${id}`, state: 'draft', khoa: String(vals.origin ?? ''), lines });
        return id;
      }
      return execGoc(model, method, args, kw);
    });
    return { odoo, soPhieu: () => daGhi.length };
  };

  it('lần 2 cùng nội dung → báo phiếu cũ, KHÔNG tạo; nói "tạo phiếu nhập mới" → tạo', async () => {
    const { odoo, soPhieu } = dungMayMua();
    const tinGui: string[] = [];
    const deps: GomDonDeps = {
      prisma: fakeDb() as never, odoo: odoo as never,
      generate: fakeGenerate([{ nhapHang: true, khach: 'Trung Quốc', dong: [{ sp: 'nguồn df-12v400w', sl: 100 }] }]),
      anhClient: null, odooUrl: 'https://odoo.example.com',
      guiTin: async (t) => { tinGui.push(t); }, guiAnhHoaDon: async () => {}, ghiLog: () => {},
    };
    const goi = (cau: string, seq: number, conv: string) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId: conv, seq, cau, senderUid: 'nv',
    });
    await goi('tạo phiếu nhập hàng của ncc Trung Quốc 100 cái nguồn df-12v400w', 8301, 'c-trung-noi-dung');
    expect(soPhieu()).toBe(1);

    await goi('tạo phiếu nhập hàng của ncc Trung Quốc 100 cái nguồn df-12v400w', 8302, 'c-trung-noi-dung');
    expect(soPhieu()).toBe(1); // KHÔNG đẻ bản trùng
    expect(tinGui.join('\n')).toMatch(/đã có rồi/i);

    await goi('tạo phiếu nhập hàng MỚI của ncc Trung Quốc 100 cái nguồn df-12v400w', 8303, 'c-trung-noi-dung');
    expect(soPhieu()).toBe(2); // NV nói rõ "mới" thì chiều
  });
});
