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
        // Tra theo id (đường alias) → trả đúng SP đó.
        const mid = (domain as unknown[]).find(
          (x): x is [string, string, number] => Array.isArray(x) && x[0] === 'id');
        if (mid) return sanPham.filter((p) => p.id === Number(mid[2]));
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
