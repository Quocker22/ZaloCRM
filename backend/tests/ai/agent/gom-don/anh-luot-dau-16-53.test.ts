// SPDX-License-Identifier: AGPL-3.0-or-later
// REPLAY CA THẬT — LƯỢT ĐẦU phiếu nhập, 16:53:09 → 16:53:44 ngày 12/08/2026.
//
//   16:53:09  NV : [Ảnh danh sách hàng] "@Tiểu Mã Nelia tạo phiếu nhập hàng
//                   giúp tôi nhà cung cấp là Trung Quốc"
//   16:53:38  Bot: 'Có 2 nhà cung cấp tên "Trung Quốc": 1)… 2)… chọn giúp em'
//   16:53:44  NV : "1"
//   16:53:44  Bot: 'Anh/chị nhập những hàng gì ạ?'   ← HỎI THỨ ĐÃ CÓ TRONG ẢNH
//   Anh Quốc: "các sản phẩm tôi đã gửi trong ảnh rồi phải phân tích ảnh rồi lấy
//              sản phẩm trong đó chứ".
//
// KHÁC GỐC với `replay-anh-phieu-nhap-12-08.test.ts` (ca 11:50): ở ca đó ảnh
// tới ở lượt THỨ BA, sau khi NCC đã chốt. Ca này ảnh đi KÈM NGAY LƯỢT ĐẦU,
// cùng một tin Zalo — nên `dong` phải có hàng NGAY từ lượt 1, trước cả khi
// nhân viên chọn NCC. Đường này chưa test nào phủ.
//
// Đo đường đi ĐÃ KIỂM CHỨNG (không đoán): `luong-media` ghép chuỗi
// `<chú thích>\n[Khách gửi ảnh, nội dung trong ảnh: …]` và ném sang luồng
// nhân viên NGUYÊN VẸN (test `anh-luot-dau-mat-chu-thich.test.ts` đã đo).
// Vậy câu vào máy gom đơn ở lượt 1 CÓ ĐỦ cả ý định lẫn danh sách hàng.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';
import { ilike, khopDomain } from '../../odoo/ilike-gia.js';
import { ghepCauTuAnh } from '../../../../src/modules/ai/agent/noi-zalo/luong-media.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** Nội dung ảnh thật lúc 16:53:09 — giấy viết tay. */
const NOI_DUNG_ANH = [
  'P10 full out: 10.000 tấm | 242 thùng',
  'P5 full out: 1460 tấm',
  'Cabin 960*960*120: 80 cái',
  'Quạt gió: 160 cái',
].join('\n');

/**
 * Lượt 16:53:09 — chú thích + ảnh, dựng bằng CHÍNH `ghepCauTuAnh` của prod
 * thay vì chép tay chuỗi. Nhờ vậy đổi cách ghép ở `luong-media` mà quên đường
 * gom đơn thì test này đỏ ngay, không im lặng trôi qua.
 */
const CAU_16_53 = ghepCauTuAnh(
  'tạo phiếu nhập hàng giúp tôi nhà cung cấp là Trung Quốc', NOI_DUNG_ANH);

function fakeOdoo() {
  const ncc = [
    { id: 314, name: 'Trung Quốc', ref: 'NCC000001', supplier_rank: 5 },
    { id: 21, name: 'Trung Quốc- Kho Cô Lỳ', ref: 'NCC000290', supplier_rank: 2 },
  ];
  const products = [
    { id: 901, name: 'Màn hình LED P10 full out', default_code: 'P10FO', list_price: 0, uom_id: [1, 'Tấm'] },
    { id: 902, name: 'Màn hình LED P5 full out', default_code: 'P5FO', list_price: 0, uom_id: [1, 'Tấm'] },
    { id: 903, name: 'Cabin 960*960*120', default_code: 'CB960', list_price: 0, uom_id: [1, 'Cái'] },
    { id: 904, name: 'Quạt gió', default_code: 'QG01', list_price: 0, uom_id: [1, 'Cái'] },
  ];

  const searchRead = vi.fn(async (model: string, domain: unknown[], _f: unknown, opts?: { limit?: number }) => {
    const s = JSON.stringify(domain);
    if (model === 'res.partner') {
      const theoId = (domain as unknown[][]).find((d) => Array.isArray(d) && d[0] === 'id' && d[1] === '=');
      if (theoId) return ncc.filter((p) => p.id === Number(theoId[2]));
      const theoRef = (domain as unknown[][]).find(
        (d) => Array.isArray(d) && d[0] === 'ref' && d[1] === '=ilike');
      if (theoRef) {
        const m = String(theoRef[2]).toLowerCase();
        return ncc.filter((p) => (p.ref ?? '').toLowerCase() === m).slice(0, opts?.limit ?? 10);
      }
      return ncc.filter((p) => khopDomain(domain, (dk) =>
        dk[0] === 'name' && dk[1] === 'ilike' ? ilike(`%${String(dk[2])}%`, p.name)
          : dk[0] === 'supplier_rank' ? Number(p.supplier_rank ?? 0) > 0
            : true)).slice(0, opts?.limit ?? 10);
    }
    if (model === 'product.product') {
      const theoId = (domain as unknown[][]).find((d) => Array.isArray(d) && d[0] === 'id' && d[1] === 'in');
      if (theoId) return products.filter((p) => (theoId[2] as number[]).includes(p.id));
      const g = (domain as unknown[]).find(
        (d): d is [string, string, number] => Array.isArray(d) && d[0] === 'list_price');
      if (g && g[1] === '>') return [];
      return products.filter((p) => khopDomain(domain, (dk) =>
        dk[0] === 'name' && dk[1] === 'ilike' ? ilike(`%${String(dk[2])}%`, p.name)
          : dk[0] === 'default_code' && dk[1] === 'ilike'
            ? ilike(`%${String(dk[2])}%`, p.default_code)
            : true));
    }
    if (model === 'purchase.order') {
      if (s.includes('origin') && !s.includes('"id"')) return [];
      return [{ id: 7001, name: 'P04531', state: 'draft', amount_total: 0, origin: 'zalo:c-16-53:1' }];
    }
    return [];
  });

  return { searchRead, execute: vi.fn(async () => 7001) };
}

/**
 * LLM giả. `docDuocAnh=true` = model làm ĐÚNG lời dặn "NỘI DUNG ẢNH" trong
 * trich-slot.ts: lấy ý định + NCC từ chú thích VÀ danh sách hàng từ khối ảnh.
 * `false` = model chỉ đọc chú thích, bỏ qua khối ảnh (hình dạng hỏng).
 */
const DONG_TRONG_ANH = [
  { sp: 'P10 full out', sl: 10000 },
  { sp: 'P5 full out', sl: 1460 },
  { sp: 'Cabin 960*960*120', sl: 80 },
  { sp: 'Quạt gió', sl: 160 },
];

function fakeGenerate(docDuocAnh: boolean): ToolAwareGenerate {
  return async (a) => {
    const nd = String(a.messages[0].content);
    let input: Record<string, unknown> = {};
    // LƯỢT TRÍCH LẠI (hàng rào code): máy đưa RIÊNG khối ảnh, không kèm lời
    // nhắn. Model nhìn danh sách hàng trần thì trích ra được — kể cả con model
    // vừa bỏ sót ở lượt đầu, vì giờ không còn lời nhắn để nó bám vào.
    if (!nd.includes('tạo phiếu nhập hàng') && nd.includes('P10 full out')) {
      input = { dong: DONG_TRONG_ANH };
    } else if (nd.includes('tạo phiếu nhập hàng giúp tôi nhà cung cấp')) {
      input = docDuocAnh
        ? { nhapHang: true, khach: 'Trung Quốc', dong: DONG_TRONG_ANH }
        : { nhapHang: true, khach: 'Trung Quốc' };
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

function dungMay(conversationId: string, docDuocAnh: boolean) {
  const odoo = fakeOdoo();
  const db = fakeDb();
  const tinGui: string[] = [];
  const deps: GomDonDeps = {
    prisma: db as never, odoo: odoo as never, generate: fakeGenerate(docDuocAnh),
    anhClient: null, odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {},
    ghiLog: () => {},
  };
  return {
    goi: (cau: string, seq = 1) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId, seq, cau, senderUid: 'uid-quoc',
    }),
    tinGui, odoo, db,
  };
}

function phienDangLuu(db: ReturnType<typeof fakeDb>, cid: string): Record<string, unknown> | null {
  const row = db.rows.get(cid);
  return row ? (row.slots as Record<string, unknown>) : null;
}

describe('ca thật 16:53 12/08 — ảnh kèm NGAY lượt đầu của phiếu nhập', () => {
  it('model ĐỌC ảnh → sau khi chọn NCC, KHÔNG hỏi lại "nhập những hàng gì"', async () => {
    const { goi, tinGui } = dungMay('c-doc-duoc', true);

    await goi(CAU_16_53, 1);
    const tinTruoc = tinGui.length;
    await goi('1', 2);

    const tinSau = tinGui.slice(tinTruoc).join('\n');
    expect(tinSau).not.toContain('nhập những hàng gì');
  });

  it('model ĐỌC ảnh → hàng trong ảnh vào phiên NGAY lượt đầu', async () => {
    const { goi, db } = dungMay('c-dong-luot-1', true);

    await goi(CAU_16_53, 11);

    const phien = phienDangLuu(db, 'c-dong-luot-1');
    const dong = (phien?.dong ?? []) as unknown[];
    expect(dong.length).toBeGreaterThan(1);
  });

  it('HÀNG RÀO CODE: model BỎ QUA khối ảnh → máy TRÍCH LẠI, không hỏi lại', async () => {
    // ĐÂY LÀ TEST QUAN TRỌNG NHẤT của bản vá 12/08.
    //
    // Dựng đúng hình dạng HỎNG đo được trên prod: model lấy ý định + tên NCC từ
    // lời nhắn nhưng BỎ QUA danh sách hàng trong ảnh (`dong` rỗng). Trước vá,
    // `buocTiepTheo` ra `hoi_thieu:'sp'` → đúng câu sai 16:53:44.
    //
    // Sau vá, code phải tự trích lại RIÊNG khối ảnh và lấy được hàng — KHÔNG
    // phụ thuộc model có ngoan hay không. Đây là lý do hàng rào nằm ở code:
    // prompt đã dặn từ 11/08 mà 12/08 vẫn hỏng y hệt.
    const { goi, tinGui, db } = dungMay('c-bo-qua', false);

    await goi(CAU_16_53, 21);
    await goi('1', 22);

    expect(tinGui.join('\n')).not.toContain('nhập những hàng gì');
    const phien = phienDangLuu(db, 'c-bo-qua');
    if (phien) expect(((phien.dong ?? []) as unknown[]).length).toBeGreaterThan(1);
  });
});
