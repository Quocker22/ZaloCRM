// SPDX-License-Identifier: AGPL-3.0-or-later
// KHO + TẶNG KÈM + CHIẾT KHẤU THEO DÒNG — ba việc chốt ngày 11/08, cùng một câu thật.
//
// Câu nhân viên (ca thật):
//   "100 cái thẻ nhận v7512 x giá 230k triết khấu 8%. 10 cái ovp k2 x giá 2300k tặng 1 cái"
//
// Ba thứ câu này đòi, mà máy cũ không có:
//
//  1. CHIẾT KHẤU THEO DÒNG (bug). Luật cũ: "chiết khấu nói riêng thì áp cho MỌI
//     dòng" (`chietKhauDon`). Ở câu trên 8% đứng NGAY SAU món thứ nhất nên chỉ
//     thuộc món đó — áp sang "ovp k2" là bớt nhầm 1.840.000đ tiền thật của công ty.
//     Chiết khấu chỉ áp cả đơn khi nói TÁCH RIÊNG ("triết khấu 8% nữa em").
//
//  2. TẶNG KÈM. Đo trên Odoo prod: 34/597 dòng giá 0đ, nhưng KHÔNG phải quà tặng
//     hết — có dòng 428 con ốc, 107 sợi cáp (phụ kiện đi kèm). Không dòng nào ghi
//     chữ "tặng" nên báo cáo không tách nổi quà thật với phụ kiện. Từ nay dòng
//     tặng ghi giá 0đ VÀ gắn "(tặng)" vào tên dòng.
//
//  3. KHO. Đo trên Odoo prod: 291/300 đơn gần nhất dùng kho TT, 9 đơn dùng HCM;
//     175/978 SP (18%) có tồn ở NHIỀU hơn một kho. Nên: mặc định KHÔNG đặt gì
//     (Odoo tự lấy TT như cũ), chỉ hỏi khi SP nằm nhiều kho VÀ nhân viên chưa nói.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function fakeGenerate(slots: Record<string, unknown>[]): ToolAwareGenerate {
  let i = 0;
  return async () => {
    const input = slots[Math.min(i++, slots.length - 1)];
    return {
      text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't', name: 'ghi_slot', input }],
    };
  };
}

/** Hai SP của câu thật. `khoCuaSp` = danh sách kho CÓ TỒN của từng SP. */
function fakeOdoo(khoCuaSp: Record<number, Array<{ warehouse_id: number; name: string; on_hand: number }>> = {}) {
  const kh = [{ id: 3803, name: 'Anh Cảnh - Led Việt - Tam Kỳ', ref: 'KH003067ACDL', phone: false }];
  const THE = { id: 448, name: 'Card thu BX-V7512 (cái)', default_code: 'SP000448', list_price: 250000, uom_id: [1, 'Cái'] };
  const OVP = { id: 902, name: 'Nguồn OVP K2 (cái)', default_code: 'SP000902', list_price: 2400000, uom_id: [1, 'Cái'] };
  const theoTen = (d: string) => (d.includes('ovp') || d.includes('OVP') || d.includes('k2') ? [OVP] : [THE]);

  return {
    searchRead: vi.fn(async (model: string, domain: unknown[], fields?: unknown) => {
      const d = JSON.stringify(domain);
      if (model === 'res.partner') return kh;
      if (model === 'product.product') {
        // Nhánh tra TỒN theo kho (feature mới) — nhận ra bằng field breakdown.
        if (JSON.stringify(fields ?? []).includes('incokit_stock_breakdown')) {
          const id = Number(/\[\s*"id"\s*,\s*"(?:=|in)"\s*,\s*\[?(\d+)/.exec(d)?.[1] ?? 0);
          const ds = khoCuaSp[id] ?? [];
          return [{ id, name: id === 902 ? OVP.name : THE.name, incokit_stock_breakdown: ds }];
        }
        const g = (domain as unknown[]).find(
          (x): x is [string, string, number] => Array.isArray(x) && x[0] === 'list_price');
        if (g && g[1] === '<=') return [];
        // Kiểm giá lúc tạo đơn: hỏi theo ['id','in',[...]] → trả cả hai SP.
        if (d.includes('"in"')) return [THE, OVP].map((s) => ({ ...s, active: true }));
        return theoTen(d);
      }
      // Bỏ bước chốt (11/08) → lượt đầu đã tạo đơn thật, nên tool tao_don_nhap
      // ĐỌC LẠI đơn vừa tạo để xác nhận. Tra theo client_order_ref (chống
      // trùng) phải rỗng; tra theo id là đọc lại → trả đơn draft.
      if (model === 'sale.order') {
        if (d.includes('client_order_ref')) return [];
        return [{ id: 26742, name: 'S13825', state: 'draft', amount_total: 21160000, amount_untaxed: 21160000 }];
      }
      return [];
    }),
    execute: vi.fn(async () => 26742),
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

function dungMay(
  slots: Record<string, unknown>[],
  khoCuaSp: Record<number, Array<{ warehouse_id: number; name: string; on_hand: number }>> = {},
) {
  const odoo = fakeOdoo(khoCuaSp);
  const db = fakeDb();
  const tinGui: string[] = [];
  const deps: GomDonDeps = {
    prisma: db as never, odoo: odoo as never, generate: fakeGenerate(slots),
    anhClient: null, odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {}, ghiLog: () => {},
  };
  return {
    goi: (cau: string) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId: 'c-kho', seq: 1, cau, senderUid: 'uid-nv',
    }),
    tinGui, odoo, db,
  };
}

/** Lệnh sale.order create mà máy gửi sang Odoo. */
function lenhTaoDon(odoo: ReturnType<typeof fakeOdoo>): unknown {
  return odoo.execute.mock.calls.find(
    (c) => String(c[0]) === 'sale.order' && String(c[1]) === 'create');
}

/** Vals của lệnh create ở trên (partner_id, warehouse_id, order_line…). */
function valsTaoDon(odoo: ReturnType<typeof fakeOdoo>): Record<string, unknown> {
  const goi = lenhTaoDon(odoo) as [string, string, Array<Record<string, unknown>>];
  return goi[2][0];
}

/** Các dòng hàng (phần vals của lệnh (0,0,{…})) trong đơn vừa tạo. */
function dongTaoDon(odoo: ReturnType<typeof fakeOdoo>): Array<Record<string, unknown>> {
  const ol = valsTaoDon(odoo).order_line as Array<[number, number, Record<string, unknown>]>;
  return ol.map((x) => x[2]);
}

// ── 1. CHIẾT KHẤU THEO DÒNG ────────────────────────────────────────────────
describe('chiết khấu đứng SAU một sản phẩm thì chỉ thuộc sản phẩm đó (câu thật 11/08)', () => {
  const CAU = '100 cái thẻ nhận v7512 x giá 230k triết khấu 8%. 10 cái ovp k2 x giá 2300k tặng 1 cái';

  it('8% chỉ vào dòng thẻ nhận, KHÔNG lan sang ovp k2', async () => {
    const { goi, odoo } = dungMay([
      {
        lenDon: true, khach: 'cảnh tam kỳ',
        dong: [
          { sp: 'thẻ nhận v7512', sl: 100, gia: 230000, chietKhau: 8 },
          { sp: 'ovp k2', sl: 10, gia: 2300000 },
        ],
      },
      { xacNhan: true },
    ]);
    await goi(CAU);
    await goi('ok em');

    // Dòng thẻ nhận (SP 448) có discount 8; dòng ovp (SP 902) KHÔNG có discount.
    const dong = dongTaoDon(odoo);
    expect(dong.find((d) => d.product_id === 448)!.discount).toBe(8);
    expect(dong.find((d) => d.product_id === 902)!.discount).toBeUndefined();
  });

  // Chiết khấu nói TÁCH RIÊNG (không dính vào một món nào) → áp CẢ ĐƠN.
  //
  // Từ 11/08 câu này phải nằm CÙNG lượt với đơn: bỏ bước chốt nghĩa là đơn lên
  // ngay ở lượt đủ thông tin, không còn khoảng chờ để nói thêm. Nói sau khi đơn
  // đã lên thì đó là việc của "sửa đơn" (chế 'sua'), không phải máy gom nữa.
  it('chiết khấu nói TÁCH RIÊNG (chietKhauDon) → áp cho CẢ ĐƠN', async () => {
    const { goi, odoo } = dungMay([
      {
        lenDon: true, khach: 'cảnh tam kỳ', chietKhauDon: 8,
        dong: [
          { sp: 'thẻ nhận v7512', sl: 100, gia: 230000 },
          { sp: 'ovp k2', sl: 10, gia: 2300000 },
        ],
      },
    ]);
    await goi('lên đơn 100 thẻ nhận v7512 giá 230k, 10 ovp k2 giá 2300k, triết khấu 8%');

    const dong = dongTaoDon(odoo);
    expect(dong.find((d) => d.product_id === 448)!.discount).toBe(8);
    expect(dong.find((d) => d.product_id === 902)!.discount).toBe(8);
  });

  it('tóm tắt cho nhân viên cũng chỉ trừ ở đúng dòng có chiết khấu', async () => {
    const { goi, tinGui } = dungMay([{
      lenDon: true, khach: 'cảnh tam kỳ',
      dong: [
        { sp: 'thẻ nhận v7512', sl: 100, gia: 230000, chietKhau: 8 },
        { sp: 'ovp k2', sl: 10, gia: 2300000 },
      ],
    }]);
    await goi(CAU);
    const tra = tinGui.join('\n');
    expect(tra).toContain('21.160.000');  // 100 × 230k × 0,92
    expect(tra).toContain('23.000.000');  // 10 × 2.300k — KHÔNG bị trừ 8%
    expect(tra).not.toContain('21.160.000đ\n');  // không phải cả hai dòng cùng số
  });
});

// ── 2. TẶNG KÈM ────────────────────────────────────────────────────────────
describe('tặng kèm — giá 0đ VÀ ghi rõ "(tặng)" trong tên dòng', () => {
  it('"tặng 1 cái" → dòng riêng, giá 0, tên có chữ (tặng)', async () => {
    const { goi, odoo } = dungMay([
      {
        lenDon: true, khach: 'cảnh tam kỳ',
        dong: [
          { sp: 'ovp k2', sl: 10, gia: 2300000 },
          { sp: 'ovp k2', sl: 1, tang: true },
        ],
      },
      { xacNhan: true },
    ]);
    await goi('lên đơn 10 cái ovp k2 x giá 2300k tặng 1 cái');
    await goi('ok em');

    const dong = dongTaoDon(odoo);
    const tang = dong.filter((d) => String(d.name ?? '').includes('(tặng)'));
    expect(tang).toHaveLength(1);
    expect(tang[0].product_uom_qty).toBe(1);
    expect(tang[0].price_unit).toBe(0);
    // Dòng BÁN vẫn nguyên giá — tặng kèm không được đè lên dòng bán cùng SP.
    const ban = dong.filter((d) => !String(d.name ?? '').includes('(tặng)'));
    expect(ban).toHaveLength(1);
    expect(ban[0].price_unit).toBe(2300000);
    expect(ban[0].product_uom_qty).toBe(10);
  });

  it('tóm tắt nói rõ hàng tặng và KHÔNG cộng tiền dòng tặng vào tổng', async () => {
    const { goi, tinGui } = dungMay([{
      lenDon: true, khach: 'cảnh tam kỳ',
      dong: [
        { sp: 'ovp k2', sl: 10, gia: 2300000 },
        { sp: 'ovp k2', sl: 1, tang: true },
      ],
    }]);
    await goi('lên đơn 10 cái ovp k2 x giá 2300k tặng 1 cái');
    const tra = tinGui.join('\n');
    expect(tra).toMatch(/tặng/i);
    // Tổng = 10 × 2.300.000 = 23.000.000, dòng tặng 0đ không làm đội tổng.
    expect(tra).toContain('Tổng: 23.000.000đ');
  });

  it('dòng tặng KHÔNG bị hỏi giá dù SP chưa có giá trong Odoo (hàng tặng vốn 0đ)', async () => {
    const { goi, tinGui } = dungMay([{
      lenDon: true, khach: 'cảnh tam kỳ',
      dong: [
        { sp: 'ovp k2', sl: 10, gia: 2300000 },
        { sp: 'thẻ nhận v7512', sl: 1, tang: true },
      ],
    }]);
    await goi('lên đơn 10 ovp k2 giá 2300k, tặng 1 thẻ nhận v7512');
    expect(tinGui.join('\n')).not.toMatch(/chưa có giá trong hệ thống/i);
  });
});

// ── 3. KHO ─────────────────────────────────────────────────────────────────
//
// BỎ HỎI KHO (anh Quốc chốt 11/08, nguyên văn):
//   "à còn cái này, mặc định là lấy kho TT nhé, không cần hỏi nhân viên luôn,
//    cứ lấy từ TT nào nhân viên nói sửa sang kho khác thì sửa thôi"
//
// Sáng 11/08 máy có hỏi kho khi hàng nằm nhiều kho. Đo lại trên prod: 291/300
// đơn gần nhất dùng TT, chỉ 9 đơn dùng HCM — tức 97% câu hỏi kho là thừa, mua
// một lượt hỏi cho thứ gần như không bao giờ đổi.
//
// Luật MỚI: KHÔNG BAO GIỜ hỏi kho. Nhân viên nói thì nghe, không nói thì im
// lặng để Odoo tự lấy kho mặc định.
//
// Kiểm chứng "Odoo tự điền TT" trên prod 11/08 (không phải suy đoán): 8 đơn
// gần nhất do chính bot tạo mà KHÔNG gửi warehouse_id đều ra warehouse_id=2
// (Chi nhánh trung tâm). Field required=true nhưng Odoo có `_default_warehouse_id`
// điền lúc create, nên bỏ trống là an toàn.
describe('kho — KHÔNG BAO GIỜ hỏi, mặc định để Odoo lấy TT (anh Quốc chốt 11/08)', () => {
  const MOT_KHO = { 448: [{ warehouse_id: 2, name: '[TT] Chi nhánh trung tâm', on_hand: 500 }] };
  const NHIEU_KHO = {
    448: [
      { warehouse_id: 2, name: '[TT] Chi nhánh trung tâm', on_hand: 500 },
      { warehouse_id: 3, name: '[HCM] Hồ Chí Minh', on_hand: 200 },
    ],
  };

  it('SP chỉ có tồn MỘT kho → KHÔNG hỏi, và KHÔNG gửi warehouse_id (Odoo tự lấy TT)', async () => {
    const { goi, odoo, tinGui } = dungMay([
      { lenDon: true, khach: 'cảnh tam kỳ', dong: [{ sp: 'thẻ nhận v7512', sl: 100, gia: 230000 }] },
      { xacNhan: true },
    ], MOT_KHO);
    await goi('lên đơn cho anh cảnh 100 thẻ nhận v7512 giá 230k');
    expect(tinGui.join('\n')).not.toMatch(/kho nào/i);
    await goi('ok em');
    expect(JSON.stringify(lenhTaoDon(odoo))).not.toContain('warehouse_id');
  });

  it('hàng nằm NHIỀU kho mà NV không nói gì → KHÔNG hỏi, lên đơn luôn', async () => {
    const { goi, tinGui } = dungMay([
      { lenDon: true, khach: 'cảnh tam kỳ', dong: [{ sp: 'thẻ nhận v7512', sl: 100, gia: 230000 }] },
    ], NHIEU_KHO);
    await goi('lên đơn cho anh cảnh 100 thẻ nhận v7512 giá 230k');

    const tra = tinGui.join('\n');
    // Không một chữ nào hỏi kho — đây chính là lượt hỏi anh Quốc bảo bỏ.
    expect(tra).not.toMatch(/kho nào/i);
    expect(tra).not.toMatch(/có ở \d+ kho/i);
    // Đi thẳng tới ĐƠN, không kẹt thêm lượt nào — và không rủ chốt nữa
    // (bỏ bước chốt 11/08).
    expect(tra).toMatch(/Tổng:/);
    expect(tra).not.toMatch(/chốt lên đơn/i);
    expect(tra).toContain('S13825');
  });

  it('hàng NHIỀU kho, NV không nói kho → tạo đơn KHÔNG gửi warehouse_id', async () => {
    const { goi, odoo } = dungMay([
      { lenDon: true, khach: 'cảnh tam kỳ', dong: [{ sp: 'thẻ nhận v7512', sl: 100, gia: 230000 }] },
      { xacNhan: true },
    ], NHIEU_KHO);
    await goi('lên đơn cho anh cảnh 100 thẻ nhận v7512 giá 230k');
    await goi('ok em');
    // Bỏ trống = Odoo điền TT (đo prod: 8/8 đơn bot tạo gần nhất ra kho 2).
    expect(JSON.stringify(lenhTaoDon(odoo))).not.toContain('warehouse_id');
  });

  it('NV nói sẵn "kho HCM" trong câu → vẫn đặt đúng warehouse_id=3', async () => {
    const { goi, odoo, tinGui } = dungMay([
      {
        lenDon: true, khach: 'cảnh tam kỳ', kho: 'HCM',
        dong: [{ sp: 'thẻ nhận v7512', sl: 100, gia: 230000 }],
      },
      { xacNhan: true },
    ], NHIEU_KHO);
    await goi('lên đơn cho anh cảnh 100 thẻ nhận v7512 giá 230k lấy kho Hồ Chí Minh');
    expect(tinGui.join('\n')).not.toMatch(/kho nào/i);
    await goi('ok em');
    expect(JSON.stringify(lenhTaoDon(odoo))).toContain('"warehouse_id":3');
  });

  // Nói kho ở lượt SAU: từ 11/08 lượt đầu đã tạo đơn (bỏ bước chốt), nên câu
  // "xuất kho B nhé" đến sau là việc của SỬA ĐƠN, không phải máy gom. Điều máy
  // gom phải bảo đảm ở đây: kho nói CÙNG lượt vẫn vào đúng đơn — và ca thiếu
  // thông tin (chưa đủ để lên đơn) thì kho nói lượt sau vẫn nhận.
  it('kho nói ở lượt sau khi đơn CHƯA đủ thông tin → vẫn nhận, đặt warehouse_id=4', async () => {
    const { goi, odoo } = dungMay([
      // Lượt 1 thiếu số lượng → máy hỏi, chưa lên đơn.
      { lenDon: true, khach: 'cảnh tam kỳ', dong: [{ sp: 'thẻ nhận v7512', gia: 230000 }] },
      // Lượt 2 bổ sung SL + kho cùng lúc → đủ, lên đơn ngay.
      { kho: 'KB', dong: [{ sp: 'thẻ nhận v7512', sl: 100, gia: 230000 }] },
    ], NHIEU_KHO);
    await goi('lên đơn cho anh cảnh thẻ nhận v7512 giá 230k');
    await goi('100 cái, xuất kho B nhé em');
    expect(JSON.stringify(lenhTaoDon(odoo))).toContain('"warehouse_id":4');
  });

  it('NV nói kho KHÔNG tồn tại ("kho Đà Nẵng") → báo rõ chứ không im, không đặt kho bừa', async () => {
    const { goi, odoo, tinGui } = dungMay([
      {
        lenDon: true, khach: 'cảnh tam kỳ', kho: 'Đà Nẵng',
        dong: [{ sp: 'thẻ nhận v7512', sl: 100, gia: 230000 }],
      },
    ], NHIEU_KHO);
    await goi('lên đơn cho anh cảnh 100 thẻ nhận v7512 giá 230k, lấy kho Đà Nẵng nhé');

    // Im lặng bỏ qua là bẫy: NV tưởng hàng xuất Đà Nẵng, thực tế ra TT.
    // Cảnh báo này giờ nằm trong CHÍNH tin báo đơn đã lên — vẫn phải có đủ,
    // vì đơn nháp sửa được và nhân viên cần biết ngay để sửa.
    const tra = tinGui.join('\n');
    expect(tra).toMatch(/Đà Nẵng/i);
    expect(tra).toMatch(/Chi nhánh trung tâm|Hồ Chí Minh|Kho B/);

    // Không map được thì KHÔNG ghi kho bừa — để Odoo lấy mặc định.
    expect(JSON.stringify(lenhTaoDon(odoo))).not.toContain('warehouse_id');
  });

  // Vì sao tóm tắt chỉ hiện kho khi NV nói rõ: 291/300 đơn dùng TT, in "Kho
  // xuất: Chi nhánh trung tâm" lên mọi đơn là thêm một dòng nhiễu cho 97% ca.
  // Nhưng khi NV ĐÃ nói kho thì PHẢI hiện, để họ soát bot có hiểu đúng không.
  it('tóm tắt: NV nói kho → HIỆN "Kho xuất"; không nói → KHÔNG hiện dòng nào', async () => {
    const { goi: goiNoi, tinGui: tinNoi } = dungMay([{
      lenDon: true, khach: 'cảnh tam kỳ', kho: 'HCM',
      dong: [{ sp: 'thẻ nhận v7512', sl: 100, gia: 230000 }],
    }], NHIEU_KHO);
    await goiNoi('lên đơn cho anh cảnh 100 thẻ nhận v7512 giá 230k kho HCM');
    expect(tinNoi.join('\n')).toContain('Kho xuất: Hồ Chí Minh');

    const { goi: goiIm, tinGui: tinIm } = dungMay([{
      lenDon: true, khach: 'cảnh tam kỳ',
      dong: [{ sp: 'thẻ nhận v7512', sl: 100, gia: 230000 }],
    }], NHIEU_KHO);
    await goiIm('lên đơn cho anh cảnh 100 thẻ nhận v7512 giá 230k');
    expect(tinIm.join('\n')).not.toContain('Kho xuất');
  });
});
