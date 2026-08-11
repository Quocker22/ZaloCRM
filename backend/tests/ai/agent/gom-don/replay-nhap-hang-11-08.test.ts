// SPDX-License-Identifier: AGPL-3.0-or-later
// KỊCH BẢN REPLAY — nguyên văn chat hỏng 22:09→22:11 ngày 11/08/2026 (nhóm Test-AI).
//
//   22:09  NV : "rồi tạo phiếu nhập hàng giúp tôi luôn"          (đã bóc tag @bot)
//          bot: "em hiện chỉ có tool lên đơn BÁN và quản lý tồn, chưa có tool
//                tạo phiếu nhập hàng (mua hàng) — em không thể tạo phiếu nhập
//                kho được ạ."
//   22:11  NV : "1 đơn hàng của hàng cung cấp trung quốc, 2 Màn hình LED: P10
//                full out: 10.000 tấm..."     (danh sách 13 dòng hàng)
//          bot: "tính năng này nằm ngoài phạm vi em hỗ trợ"
//
// Anh Quốc: "hiện tại tính năng nhập hàng chưa được rồi".
//
// BOT NÓI SAI — quyền ghi vốn đã có. Đo prod cùng ngày bằng tài khoản bot_zalo:
//   purchase.order write=true create=true · purchase.order.line write=true
//   create=true · stock.picking write=true
// và 5 đơn mua thật P04517-P04521, 4 đơn của NCC "Trung Quốc" (id=314).
//
// Test này khoá hành vi ĐÚNG với ĐÚNG hai câu thật đó, và đặc biệt khoá việc
// phiên gom sống qua HAI LƯỢT — 22:09 mới nói ý định, 22:11 mới có hàng.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import { boDau } from '../../../../src/modules/ai/odoo/tools/tra-san-pham.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';
import { ilikeChua } from '../../odoo/ilike-gia.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** Câu nguyên văn 22:09 — tag @bot đã bị cổng nhận lệnh bóc trước khi tới máy. */
const CAU_22_09 = 'rồi tạo phiếu nhập hàng giúp tôi luôn';
/** Câu nguyên văn 22:11, rút gọn còn 3 dòng hàng đầu cho test đọc được. */
const CAU_22_11 =
  '1 đơn hàng của hàng cung cấp trung quốc, 2 Màn hình LED: P10 full out: 10.000 tấm, ' +
  'P8 full out: 5.000 tấm, module P5 trong nhà: 3.000 tấm';
/**
 * Lượt CHỌN NCC. Trên prod "Trung Quốc" ra ĐÚNG 2 nhà cung cấp (NCC000001 và
 * NCC000290) nên máy PHẢI hỏi chọn — tự chốt là rủi ro treo công nợ phải trả
 * vào sai nhà cung cấp. Đây chính là hành vi yêu cầu 11/08 đòi hỏi.
 */
const CHON_NCC = '1';

function fakeGenerate(): ToolAwareGenerate {
  return async (a) => {
    const nd = String(a.messages[0].content);
    let input: Record<string, unknown> = {};
    if (nd.includes('phiếu nhập hàng')) {
      // Model chỉ thấy Ý ĐỊNH, chưa có NCC lẫn hàng — đúng như câu thật 22:09.
      input = { nhapHang: true };
    } else if (nd.includes('hàng cung cấp trung quốc')) {
      input = {
        nhapHang: true,
        khach: 'Trung Quốc',
        dong: [
          { sp: 'P10 full out', sl: 10000 },
          { sp: 'P8 full out', sl: 5000 },
          { sp: 'module P5 trong nhà', sl: 3000 },
        ],
      };
    }
    return {
      text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't1', name: 'ghi_slot', input }],
    };
  };
}

/**
 * Odoo giả theo ĐÚNG dữ liệu thật đo trên prod 11/08.
 *
 * Điểm mấu chốt: partner "Trung Quốc" tồn tại ở CẢ HAI tập —
 *   - id=314  "Trung Quốc"            NCC000001  supplier_rank=5   ← NCC thật
 *   - id=2519 "TRung Quốc"            KH001046   customer_rank=1   ← KHÁCH HÀNG
 * Tra nhầm tập là treo phiếu nhập vào một khách hàng.
 *
 * Và cả 3 SP đều `list_price` = 0/1đ (chưa có giá bán) — bên đơn BÁN thứ này
 * làm kẹt cứng phiên (bug 17:17 10/08), bên nhập hàng thì phải chạy trơn.
 */
function fakeOdoo() {
  const ncc = [
    { id: 314, name: 'Trung Quốc', ref: 'NCC000001', supplier_rank: 5 },
    { id: 21, name: 'Trung Quốc- Kho Cô Lỳ', ref: 'NCC000290', supplier_rank: 2 },
  ];
  const khach = [{ id: 2519, name: 'TRung Quốc', ref: 'KH001046', supplier_rank: 0 }];

  const products = [
    { id: 901, name: 'Màn hình LED P10 full out', default_code: 'P10FO', list_price: 0, uom_id: [1, 'Tấm'] },
    { id: 902, name: 'Màn hình LED P8 full out', default_code: 'P8FO', list_price: 1, uom_id: [1, 'Tấm'] },
    { id: 903, name: 'Module LED P5 trong nhà', default_code: 'P5TN', list_price: 0, uom_id: [1, 'Tấm'] },
  ];

  const searchRead = vi.fn(async (model: string, domain: unknown[], _f: unknown, opts?: { limit?: number }) => {
    const s = JSON.stringify(domain);
    if (model === 'res.partner') {
      // Xác minh theo id (tool tao_don_mua gọi trước khi ghi).
      const theoId = (domain as unknown[][]).find((d) => Array.isArray(d) && d[0] === 'id' && d[1] === '=');
      if (theoId) {
        const id = Number(theoId[2]);
        return [...ncc, ...khach].filter((p) => p.id === id);
      }
      // LỌC ĐÚNG TẬP: chỉ NCC mới có supplier_rank>0.
      const chiNcc = s.includes('supplier_rank');
      const nguon = chiNcc ? ncc : khach;
      const tokens = (domain as unknown[][])
        .filter((d) => Array.isArray(d) && d[0] === 'name' && d[1] === 'ilike')
        .map((d) => String(d[2]));
      const khop = tokens.length > 0
        ? nguon.filter((p) => tokens.every((t) => ilikeChua(t, p.name)))
        : nguon;
      return khop.slice(0, opts?.limit ?? 10);
    }
    if (model === 'product.product') {
      const theoId = (domain as unknown[][]).find((d) => Array.isArray(d) && d[0] === 'id' && d[1] === 'in');
      if (theoId) {
        const ids = theoId[2] as number[];
        return products.filter((p) => ids.includes(p.id));
      }
      const g = (domain as unknown[]).find(
        (d): d is [string, string, number] => Array.isArray(d) && d[0] === 'list_price');
      if (g && g[1] === '>') return [];
      const tokens = (domain as unknown[][])
        .filter((d) => Array.isArray(d) && d[0] === 'name' && d[1] === 'ilike')
        .map((d) => String(d[2]));
      return tokens.length > 0
        ? products.filter((p) => tokens.every((t) => ilikeChua(t, p.name)))
        : products;
    }
    if (model === 'purchase.order') {
      // Tra khoá chống trùng phải rỗng; đọc lại theo id → phiếu draft.
      if (s.includes('origin') && !s.includes('"id"')) return [];
      return [{ id: 7001, name: 'P04522', state: 'draft', amount_total: 0, origin: 'zalo:c-nhap:1' }];
    }
    if (model === 'stock.quant') return [];
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

function dungMay() {
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
  return {
    goi: (cau: string) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId: 'c-nhap', seq: 1, cau, senderUid: 'uid-quoc',
    }),
    tinGui, odoo, db,
  };
}

describe('ca thật 22:09 11/08 — bot KHÔNG được từ chối việc nó làm được', () => {
  it('"tạo phiếu nhập hàng giúp tôi luôn" → máy NHẬN việc, hỏi nhà cung cấp', async () => {
    const { goi, tinGui } = dungMay();

    const nhan = await goi(CAU_22_09);

    // Nhận việc = KHÔNG rơi xuống agent tự do (nơi đã đáp "ngoài phạm vi").
    expect(nhan).toBe(true);
    expect(tinGui[0]).toContain('nhà cung cấp');
    // Tuyệt đối không còn câu từ chối.
    expect(tinGui.join(' ')).not.toMatch(/ngoài phạm vi|không thể tạo|chưa có tool/i);
  });

  it('"Trung Quốc" khớp 2 NCC → HỎI CHỌN, tuyệt đối không tự nhặt', async () => {
    // Đo prod 11/08: đúng 2 NCC khớp — id=314 "Trung Quốc" [NCC000001] và
    // id=21 "Trung Quốc- Kho Cô Lỳ" [NCC000290]. Tự chọn là treo công nợ phải
    // trả vào sai nhà cung cấp.
    const { goi, tinGui, odoo } = dungMay();

    await goi(CAU_22_09);
    await goi(CAU_22_11);

    expect(tinGui[1]).toContain('nhà cung cấp');
    expect(tinGui[1]).toContain('NCC000001');
    expect(tinGui[1]).toContain('NCC000290');
    // Chưa chọn thì CHƯA ghi gì cả.
    expect(odoo.execute.mock.calls.filter((c) => c[1] === 'create')).toHaveLength(0);
  });

  it('BA LƯỢT: 22:09 ý định → 22:11 hàng → chọn NCC → phiên nhớ, tạo được phiếu', async () => {
    // Đây là lý do phải bám máy gom đơn thay vì làm tool trần: ca thật trải qua
    // hai lượt cách nhau 2 phút. Không có phiên (TTL 15') thì lượt sau lại hỏi
    // lại từ đầu.
    const { goi, tinGui, odoo } = dungMay();

    await goi(CAU_22_09);
    await goi(CAU_22_11);
    await goi(CHON_NCC);

    // Đã GHI vào purchase.order, đúng NCC id=314, đủ 3 dòng hàng.
    const create = odoo.execute.mock.calls.find((c) => c[1] === 'create');
    expect(create).toBeDefined();
    expect(create![0]).toBe('purchase.order');
    const vals = (create![2] as unknown[])[0] as Record<string, unknown>;
    expect(vals.partner_id).toBe(314);
    expect((vals.order_line as unknown[]).length).toBe(3);

    // Báo lại cho nhân viên: mã phiếu + nói rõ là NHÁP.
    const cuoi = tinGui[tinGui.length - 1];
    expect(cuoi).toContain('P04522');
    expect(cuoi.toLowerCase()).toContain('nháp');
  });

  it('KHÔNG có giá nhập → vẫn tạo phiếu, và NÓI RÕ còn thiếu giá', async () => {
    // Cả 3 SP đều chưa có giá. Bên đơn BÁN thứ này làm kẹt cứng phiên (bug
    // 17:17 10/08); bên nhập hàng phải chạy trơn — nhưng không được im lặng.
    const { goi, tinGui, odoo } = dungMay();

    await goi(CAU_22_09);
    await goi(CAU_22_11);
    await goi(CHON_NCC);

    const vals = (odoo.execute.mock.calls.find((c) => c[1] === 'create')![2] as unknown[])[0] as Record<string, unknown>;
    // KHÔNG dòng nào bị nhét giá — kể cả giá bán (list_price 0/1đ).
    for (const line of vals.order_line as unknown[][]) {
      expect(JSON.stringify(line[2])).not.toContain('price_unit');
    }
    expect(tinGui[tinGui.length - 1]).toContain('chưa có giá nhập');
  });

  it('tra NCC đúng tập supplier_rank — KHÔNG bốc khách hàng "TRung Quốc"', async () => {
    // Trên prod có "TRung Quốc" [KH001046] là KHÁCH nằm cạnh NCC cùng tên.
    const { goi, odoo } = dungMay();

    await goi(CAU_22_09);
    await goi(CAU_22_11);
    await goi(CHON_NCC);

    const traNcc = odoo.searchRead.mock.calls.filter(
      (c) => c[0] === 'res.partner' && JSON.stringify(c[1]).includes('supplier_rank'),
    );
    expect(traNcc.length).toBeGreaterThan(0);
    // Và phiếu KHÔNG treo vào id khách hàng.
    const vals = (odoo.execute.mock.calls.find((c) => c[1] === 'create')![2] as unknown[])[0] as Record<string, unknown>;
    expect(vals.partner_id).not.toBe(2519);
  });

  it('CHỈ tạo NHÁP — không xác nhận, không sinh phiếu kho/công nợ', async () => {
    const { goi, odoo } = dungMay();

    await goi(CAU_22_09);
    await goi(CAU_22_11);
    await goi(CHON_NCC);

    const methods = odoo.execute.mock.calls.map((c) => c[1]);
    expect(methods).toEqual(['create']);
    const s = JSON.stringify(odoo.execute.mock.calls);
    expect(s).not.toContain('button_confirm');
    expect(s).not.toContain('button_approve');
  });

  it('gọi LẠI cùng seq → KHÔNG tạo phiếu thứ hai (chống trùng)', async () => {
    const { goi, odoo } = dungMay();

    await goi(CAU_22_09);
    await goi(CAU_22_11);
    await goi(CHON_NCC);
    const lanDau = odoo.execute.mock.calls.filter((c) => c[1] === 'create').length;
    // Lượt thứ ba lặp lại y nguyên câu 22:11 (phiên đã xoá sau khi tạo xong,
    // nên đây là đường vào mới — khoá idempotency phải chặn).
    await goi(CAU_22_11);

    // Tool tra khoá `origin` trước khi ghi; fake trả sẵn phiếu cũ nên không ghi thêm.
    expect(odoo.execute.mock.calls.filter((c) => c[1] === 'create').length).toBe(lanDau);
  });
});
