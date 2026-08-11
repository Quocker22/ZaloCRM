// SPDX-License-Identifier: AGPL-3.0-or-later
// KỊCH BẢN REPLAY — nguyên văn chat hỏng 15:06→15:35 11/08/2026 (nhóm Test-AI).
//
// Nhân viên mất 28 PHÚT và 8 LƯỢT NHẮC LẠI cho một đơn đáng ra xong trong 1 lượt:
//
//   15:06:59  Minh Anh: lên đơn cho chị phương ali 4 bóng lixin 4000k trung tính
//                       trong nhà 500 bóng giá 2800 nhé @Tiểu Mã Nelia
//   15:07:29  bot     : "Dạ em đã chuyển việc lên đơn ... sang bộ phận sale xử lý ạ"
//   15:09:17  bot     : hỏi lại "đơn này của khách nào, sản phẩm gì, số lượng bao nhiêu"
//   15:14:50  bot     : "đã chuyển ... sang sale ... Vì sản phẩm này chưa có giá chính thức"
//   ... (còn 3 lần "đã chuyển sang sale" nữa) ...
//   15:32:23  bot     : "Có 2 khách tên Phương ali ... chọn giúp em"   ← MÁY GOM ĐƠN mới vào
//   15:35:11  bot     : "Đã lên đơn nháp S13827 ... tổng 1.400.000đ"
//
// GỐC RỄ (vấn đề 2): câu 15:06 có ĐỦ khách + SP + SL + giá, đáng ra máy gom đơn
// nhận ngay lượt đầu. Nó KHÔNG nhận, mọi câu rơi xuống agent tự do — nơi không
// biết luật "giá NV báo thắng giá hệ thống" nên quay ra đòi giá chính thức rồi
// "chuyển sale" 5 lần, dù chính sale đang ngồi trong nhóm hỏi nó.
//
// Test này khoá hành vi ĐÚNG của máy gom đơn với ĐÚNG câu thật đó.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import { boDau } from '../../../../src/modules/ai/odoo/tools/tra-san-pham.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** Câu nguyên văn 15:06:59 — tag Zalo đã bị cổng nhận lệnh bóc trước khi tới máy. */
const CAU_15_06 = 'lên đơn cho chị phương ali 4 bóng lixin 4000k trung tính trong nhà 500 bóng giá 2800';

/**
 * LLM giả trích đúng như model thật trích được từ câu 15:06 — có khách, có SP,
 * có SL, có giá. Lượt sau là câu chọn/chốt.
 */
function fakeGenerate(): ToolAwareGenerate {
  return async (a) => {
    const nd = String(a.messages[0].content);
    const input = nd.includes('4 bóng lixin')
      ? {
          lenDon: true,
          khach: 'phương ali',
          dong: [{ sp: '4 bóng lixin 4000k trung tính trong nhà', sl: 500, gia: 2800 }],
        }
      : /chốt|uk e|ok/i.test(nd)
        ? { xacNhan: true }
        : {};
    return {
      text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't1', name: 'ghi_slot', input }],
    };
  };
}

/**
 * Odoo giả theo đúng dữ liệu thật của ca này:
 *  - 2 khách tên "Phương ALi" (bot liệt kê lúc 15:32:23)
 *  - SP "4 bóng lixin" GIÁ ẢO 1đ — chính là thứ agent tự do vin vào để nói
 *    "chưa có giá chính thức nên phải chuyển sale".
 */
function fakeOdoo() {
  const partners = [
    { id: 3516, name: 'Chị Phương ALi', ref: 'KH000034', phone: '0912345678' },
    { id: 3517, name: 'Chị Phương ALi - Hà Nội', ref: 'KH000099', phone: false },
  ].map((p) => ({ ...p, mobile: false, incokit_receivable_balance: 0 }));

  const products = [
    // Giá 1đ = placeholder (dưới NGUONG_GIA_AO) — SP chưa gắn giá chính thức.
    { id: 771, name: 'Đèn LED 4 Bóng Lixin 4000K Trung Tính Trong Nhà', default_code: 'LX4B', list_price: 1, uom_id: [1, 'Bóng'] },
  ];

  const searchRead = vi.fn(async (model: string, domain: unknown[], _f: unknown, opts?: { limit?: number }) => {
    if (model === 'res.partner') {
      const tokens = (domain as unknown[][])
        .filter((d) => Array.isArray(d) && d[0] === 'name' && d[1] === 'ilike')
        .map((d) => boDau(String(d[2])));
      const khop = tokens.length > 0
        ? partners.filter((p) => tokens.every((t) => boDau(p.name).includes(t)))
        : partners;
      return khop.slice(0, opts?.limit ?? 10);
    }
    if (model === 'product.product') {
      // Tôn trọng bộ lọc giá: SP này giá 1đ nên CHỈ ra ở nhánh "trống giá".
      const g = (domain as unknown[]).find(
        (d): d is [string, string, number] => Array.isArray(d) && d[0] === 'list_price');
      if (g && g[1] === '>') return [];
      return products;
    }
    if (model === 'stock.quant') return [];
    // Bỏ bước chốt (11/08): lượt đủ thông tin đã tạo đơn thật, nên tool
    // tao_don_nhap ĐỌC LẠI đơn vừa tạo để xác nhận. Tra theo
    // client_order_ref (chống trùng) phải rỗng; tra theo id → đơn draft.
    if (model === 'sale.order') {
      if (JSON.stringify(domain).includes('client_order_ref')) return [];
      return [{ id: 9001, name: 'S13830', state: 'draft', amount_total: 1400000, amount_untaxed: 1400000 }];
    }
    return [];
  });

  return { searchRead, execute: vi.fn(async () => 9001) };
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

function dungMay() {
  const odoo = fakeOdoo();
  const db = fakeDb();
  const tinGui: string[] = [];
  const anhGui: string[] = [];
  const deps: GomDonDeps = {
    prisma: db as never, odoo: odoo as never, generate: fakeGenerate(),
    anhClient: null, odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async (a) => { anhGui.push(a.tenFile); },
    ghiLog: () => {},
  };
  return {
    goi: (cau: string) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId: 'c-phuong-ali', seq: 1, cau, senderUid: 'uid-minhanh',
    }),
    tinGui, anhGui, odoo, db,
  };
}

describe('ca thật 15:06 11/08 — máy gom đơn PHẢI nhận việc ngay lượt đầu', () => {
  it('câu 15:06:59 (đủ khách + SP + SL + giá) không được rơi xuống agent tự do', async () => {
    const { goi } = dungMay();
    // false = máy nhường agent tự do — chính là đường dẫn tới 5 lần "chuyển sale".
    expect(await goi(CAU_15_06)).toBe(true);
  });

  it('SP giá ảo 1đ mà NV ĐÃ báo giá 2800 → KHÔNG được đòi giá, KHÔNG được nhắc "chuyển sale"', async () => {
    const { goi, tinGui } = dungMay();
    await goi(CAU_15_06);
    const tra = tinGui.join('\n');

    // Lỗi thật 15:14:50: "Vì sản phẩm này trong hệ thống chưa có giá chính thức
    // ... em đã chuyển sang bộ phận sale". Cả hai vế đều sai: giá NV báo thắng
    // giá hệ thống (luật 10/08), và sale chính là người đang hỏi.
    expect(tra).not.toMatch(/chưa có giá chính thức|giá chính thức/i);
    expect(tra).not.toMatch(/chuyển .{0,20}sale|bộ phận sale/i);
  });

  it('hỏi CHỌN KHÁCH (2 người trùng tên) — đúng việc cần hỏi, hỏi ngay lượt đầu', async () => {
    const { goi, tinGui } = dungMay();
    await goi(CAU_15_06);
    const tra = tinGui.join('\n');
    // Bot thật mãi 15:32:23 (26 phút sau) mới hỏi được câu này.
    expect(tra).toMatch(/Phương ALi/i);
    expect(tra).toMatch(/chọn/i);
  });

  it('chọn khách rồi chốt → lên đơn với giá 2800, tổng 1.400.000đ', async () => {
    const { goi, tinGui, odoo } = dungMay();
    await goi(CAU_15_06);
    await goi('1');       // 15:32:35 Quyết chọn khách số 1
    await goi('chốt');    // 15:34:57 Quyết chốt

    const json = JSON.stringify(odoo.execute.mock.calls);
    // Giá NV báo phải tới Odoo — KHÔNG được để giá ảo 1đ đè lên.
    expect(json).toContain('2800');
    const tra = tinGui.join('\n');
    expect(tra).toMatch(/1\.400\.000/);
  });
});

describe('GỐC RỄ — lệnh lên đơn RÕ RÀNG thì LLM không được phủ quyết', () => {
  /**
   * Vì sao máy gom đơn không nhận việc suốt 25 phút:
   *
   * Cửa vào (commit f99b06ac) định là "regex khớp → VÀO THẲNG, khỏi tốn lượt
   * LLM". Nhưng code chỉ dùng regex để bỏ qua lượt hỏi `lenDon`; ngay sau đó
   * nó VẪN gọi trichSlot lần nữa, và dòng `if (!daChon && trich.ngoaiLe)
   * return false` cho model quyền phủ quyết. Model chỉ cần trả ngoaiLe=true —
   * rất dễ với câu 15:06 vì prompt trích slot dạy "hoá đơn/xuất hoá đơn là
   * ngoaiLe" và câu này dài, nhiều nhiễu ("4 bóng ... 500 bóng") — là cả lệnh
   * rơi xuống agent tự do.
   *
   * Đó chính là 15:06, và mọi câu "lên đơn ..." sau đó: 15:14:24, 15:20:44,
   * 15:31:41. Cả 4 lần đều khớp regex, cả 4 lần đều bị nhường.
   *
   * LUẬT ĐÚNG: câu MANG DẤU HIỆU LỆNH LÊN ĐƠN rõ ràng (regex khớp) thì model
   * KHÔNG được nói "không liên quan đơn hàng" — nó tự mâu thuẫn. Code giữ luật,
   * LLM chỉ trích slot; đó là hợp đồng của cả máy gom đơn.
   */
  it('regex khớp "lên đơn ..." mà LLM trả ngoaiLe → máy VẪN nhận việc', async () => {
    const odoo = fakeOdoo();
    const db = fakeDb();
    const tinGui: string[] = [];
    // LLM giả CỐ TÌNH trả ngoaiLe — đúng lỗi thật của model lúc 15:06.
    const generate: ToolAwareGenerate = async () => ({
      text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't', name: 'ghi_slot', input: { ngoaiLe: true } }],
    });
    const deps: GomDonDeps = {
      prisma: db as never, odoo: odoo as never, generate,
      anhClient: null, odooUrl: 'https://odoo.example.com',
      guiTin: async (t) => { tinGui.push(t); },
      guiAnhHoaDon: async () => {}, ghiLog: () => {},
    };

    const nhan = await xuLyGomDon(deps, {
      orgId: 'o1', conversationId: 'c-ngoaile', seq: 1, cau: CAU_15_06, senderUid: 'u',
    });

    // false = nhường agent tự do = con đường dẫn tới 28 phút và 5 lần "chuyển sale".
    expect(nhan).toBe(true);
    // Và phải NÓI được gì đó cho nhân viên, không im lặng.
    expect(tinGui.length).toBeGreaterThan(0);
  });

  it('câu KHÔNG phải lệnh lên đơn + LLM nói ngoaiLe → vẫn nhường như cũ', async () => {
    // Hàng rào phải HẸP: chỉ cứu câu có dấu hiệu lệnh lên đơn rõ ràng. Câu báo
    // cáo/tồn kho vẫn phải rơi xuống agent thường, nếu không máy gom đơn nuốt
    // hết mọi việc khác.
    const odoo = fakeOdoo();
    const db = fakeDb();
    const generate: ToolAwareGenerate = async () => ({
      text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't', name: 'ghi_slot', input: { ngoaiLe: true } }],
    });
    const deps: GomDonDeps = {
      prisma: db as never, odoo: odoo as never, generate,
      anhClient: null, odooUrl: '',
      guiTin: async () => {}, guiAnhHoaDon: async () => {}, ghiLog: () => {},
    };

    expect(await xuLyGomDon(deps, {
      orgId: 'o1', conversationId: 'c-bc', seq: 1, cau: 'doanh số tháng này bao nhiêu', senderUid: 'u',
    })).toBe(false);
  });
});

describe('câu 15:33 — bot KHÔNG được lộ id nội bộ hay tự mâu thuẫn', () => {
  it('tin gửi nhân viên không chứa "id 3516" (id Odoo nội bộ)', async () => {
    const { goi, tinGui } = dungMay();
    await goi(CAU_15_06);
    await goi('1');

    const tra = tinGui.join('\n');
    // Lỗi thật 15:33:14: "Anh/chị đã chọn khách số 1 (... id 3516). ... Nhưng
    // khoan — anh/chị chọn khách số 1 lúc nãy rồi, em dùng đúng id 3516."
    // Nhân viên không cần biết id nội bộ, và "Nhưng khoan" là bot lẩm bẩm.
    expect(tra).not.toMatch(/\bid\s*\d{3,}/i);
    expect(tra).not.toMatch(/nhưng khoan/i);
  });
});
