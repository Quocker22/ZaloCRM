// SPDX-License-Identifier: AGPL-3.0-or-later
// KỊCH BẢN REPLAY — nguyên văn chat hỏng 00:40→00:50 ngày 12/08/2026.
// Ca này hỏng LẦN THỨ BA cùng một chỗ (23:15 11/08, 23:22 11/08, rồi 00:40 12/08).
//
//   00:40:15  NV : [Ảnh danh sách hàng] "@bot tạo phiếu nhập hàng giúp tôi
//                   nhà cung cấp là Trung Quốc"
//   00:40:37  Bot: "Phiếu nhập này của nhà cung cấp nào ạ? (tên hoặc mã NCC)"
//                  ^^^ NV ĐÃ NÓI NCC ngay trong câu đầu — máy vẫn hỏi lại
//   00:50:23  NV : "ncc là Trung Quốc"
//   00:50:26  Bot: "Em vẫn chưa khớp được 'ncc là Trung Quốc' với nhà cung cấp
//                   nào ạ. Anh/chị chọn SỐ THỨ TỰ trong DANH SÁCH TRÊN, hoặc
//                   gõ mã NCC..."
//                  ^^^ bảo chọn "trong danh sách trên" NHƯNG CHƯA TỪNG IN
//                      DANH SÁCH NÀO — câu template sai ngữ cảnh
//
// ĐÃ THU HẸP PHẠM VI TRƯỚC KHI VIẾT TEST (đo thật trên prod, không đoán):
//   - Bản vá bỏ dấu ĐÃ lên prod (container 00:07 giờ VN) → tin 00:40 chạy code mới.
//   - Ảnh ĐÃ đọc được (log `[doc-anh] đã đọc ảnh`).
//   - TRÍCH SLOT CHẠY ĐÚNG, đo trên prod với phiên đang ở chế 'nhap':
//       "ncc là Trung Quốc"       -> khach="Trung Quốc"  nhapHang=true   ĐÚNG
//       "nhà cung cấp Trung Quốc" -> khach="Trung Quốc"  nhapHang=true   ĐÚNG
//       "Trung Quốc"              -> khach=undefined     ngoaiLe=true    HỎNG
//
// => Lỗi KHÔNG ở trích slot, cũng KHÔNG ở tra không dấu. Nó nằm GIỮA hai chỗ đó.
//
// Vì vậy fake LLM dưới đây trả về ĐÚNG những gì model thật đã trả (đo prod),
// kể cả ca `ngoaiLe=true` cho câu "Trung Quốc" trần. Test mà cho model giả trả
// lời hoàn hảo là test một thế giới không tồn tại.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';
// `ilike` + bộ đọc DOMAIN dùng chung cho mọi Odoo giả (tests/ai/odoo/ilike-gia.ts).
//
// PHẢI dùng `khopDomain`, KHÔNG được tự gom điều kiện `name` rồi `every(...)`:
// từ vòng vá không-dấu, mỗi từ khoá nở ra một khối OR các biến thể dấu
// ("trung" → trung|trùng|trúng|…). Coi cả khối là AND thì đòi tên phải chứa
// ĐỒNG THỜI mọi biến thể — không tên nào thoả, fake trả rỗng và test đỏ oan
// trong khi code thật chạy đúng. Chính bẫy đó đã làm bản test đầu của ca này
// báo "không tra được NCC" ở lượt 1, che mất chỗ đứt thật ở lượt 2.
import { ilike, khopDomain } from '../../odoo/ilike-gia.js';
import { boDau } from '../../../../src/modules/ai/odoo/tools/tra-san-pham.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** Khối ảnh y như `luong-media.docVaChuyenTiep` ghép (đã đo, không phải bịa). */
const KHOI_ANH =
  '[Khách gửi ảnh, nội dung trong ảnh: P10 full out: 10.000 tấm\nP5 full out: 1.460 tấm]';

/**
 * Lượt 1 nguyên văn 00:40:15 — lời nhắn + khối ảnh, đúng thứ tự `luong-media`
 * dựng. Tag "@bot" đã bị cổng nhận lệnh bóc trước khi tới máy gom đơn.
 */
const CAU_00_40 = `tạo phiếu nhập hàng giúp tôi nhà cung cấp là Trung Quốc\n${KHOI_ANH}`;
/** Lượt 2 nguyên văn 00:50:23. */
const CAU_00_50 = 'ncc là Trung Quốc';

/** Odoo giả — dữ liệu NCC/khách/SP lấy đúng từ prod 11-12/08. */
function fakeOdoo() {
  const ncc = [
    { id: 314, name: 'Trung Quốc', ref: 'NCC000001', supplier_rank: 5 },
    { id: 21, name: 'Trung Quốc- Kho Cô Lỳ', ref: 'NCC000290', supplier_rank: 2 },
  ];
  // Bẫy thật: khách hàng TÊN TRÙNG nằm cạnh NCC. Tra nhầm tập là treo phiếu
  // nhập vào một khách hàng.
  const khach = [{ id: 2519, name: 'TRung Quốc', ref: 'KH001046', supplier_rank: 0 }];
  const products = [
    { id: 901, name: 'Màn hình LED P10 full out', default_code: 'P10FO', list_price: 0, uom_id: [1, 'Tấm'] },
    { id: 902, name: 'Màn hình LED P5 full out', default_code: 'P5FO', list_price: 0, uom_id: [1, 'Tấm'] },
  ];

  const searchRead = vi.fn(async (model: string, domain: unknown[], _f: unknown, opts?: { limit?: number }) => {
    const s = JSON.stringify(domain);
    if (model === 'res.partner') {
      const theoId = (domain as unknown[][]).find((d) => Array.isArray(d) && d[0] === 'id' && d[1] === '=');
      if (theoId) return [...ncc, ...khach].filter((p) => p.id === Number(theoId[2]));
      const nguon = s.includes('supplier_rank') ? ncc : khach;
      const theoRef = (domain as unknown[][]).find(
        (d) => Array.isArray(d) && d[0] === 'ref' && d[1] === '=ilike');
      if (theoRef) {
        const m = String(theoRef[2]).toLowerCase();
        return nguon.filter((p) => (p.ref ?? '').toLowerCase() === m).slice(0, opts?.limit ?? 10);
      }
      const khop = nguon.filter((p) => khopDomain(domain, (dk) =>
        dk[0] === 'name' && dk[1] === 'ilike' ? ilike(`%${String(dk[2])}%`, p.name)
          : dk[0] === 'supplier_rank' ? Number(p.supplier_rank ?? 0) > 0
            : true));
      return khop.slice(0, opts?.limit ?? 10);
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
      return [{ id: 7001, name: 'P04530', state: 'draft', amount_total: 0, origin: 'zalo:c-1208:1' }];
    }
    return [];
  });

  return { searchRead, execute: vi.fn(async () => 7001) };
}

/**
 * LLM giả trả về ĐÚNG những gì model thật trả trên prod (đã đo, xem đầu file).
 * Không "sửa" giúp model ở đây — chỗ nào model sai thì CODE phải đỡ được.
 */
function fakeGenerate(): ToolAwareGenerate {
  return async (a) => {
    const nd = String(a.messages[0].content);
    let input: Record<string, unknown> = {};
    if (nd.includes('tạo phiếu nhập hàng giúp tôi nhà cung cấp')) {
      // Lượt 00:40 — model trích ĐÚNG cả ý định, NCC lẫn hàng trong ảnh.
      input = {
        nhapHang: true,
        khach: 'Trung Quốc',
        dong: [
          { sp: 'P10 full out', sl: 10000 },
          { sp: 'P5 full out', sl: 1460 },
        ],
      };
    } else if (nd.includes('tạo phiếu nhập hàng giúp tôi')) {
      // Cùng lệnh nhưng KHÔNG kèm tên NCC — dùng để dựng trạng thái "máy vừa
      // hỏi NCC và còn tay trắng" cho ca "Trung Quốc" TRẦN ở dưới.
      input = {
        nhapHang: true,
        dong: [
          { sp: 'P10 full out', sl: 10000 },
          { sp: 'P5 full out', sl: 1460 },
        ],
      };
    } else if (nd.includes('ncc là Trung Quốc')) {
      // Lượt 00:50 — đo prod: khach="Trung Quốc", nhapHang=true. TRÍCH ĐÚNG.
      input = { nhapHang: true, khach: 'Trung Quốc' };
    } else if (nd.includes('lên đơn cho anh')) {
      // ĐƠN BÁN — chế 'len', phải giữ nguyên hành vi cũ. Model trích khách +
      // hàng như thường; ô `khach` ở chế này là KHÁCH HÀNG, không phải NCC.
      input = { lenDon: true, khach: 'Trung Quốc', dong: [{ sp: 'P10 full out', sl: 5 }] };
    } else if (nd.includes('"Trung Quốc"')) {
      // Tên NCC gõ TRẦN khi đang chờ trả lời — đo prod: model coi là LẠC ĐỀ.
      // Đây là ca bước 3: code phải đỡ, không được nhường agent thường.
      input = { ngoaiLe: true };
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

function dungMay(conversationId = 'c-1208') {
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
      orgId: 'o1', conversationId, seq: 1, cau, senderUid: 'uid-quoc',
    }),
    tinGui, odoo, db,
  };
}

/**
 * Các lượt tra NCC đã bắn sang Odoo — mỗi lượt gom lại thành MỘT chuỗi token.
 *
 * KHÔNG so được nguyên cụm "Trung Quốc" với từng điều kiện `name ilike`: bản vá
 * không-dấu tách từ khoá theo TỪ rồi nở mỗi từ ra một khối OR biến thể dấu, nên
 * domain thật chứa ["trung","trùng",…,"quốc","quồc",…] chứ không bao giờ chứa
 * nguyên cụm. Gom cả lượt thành một chuỗi rồi soi bằng `daTraTen` ở dưới.
 */
function luotTraNcc(odoo: ReturnType<typeof fakeOdoo>): string[] {
  return odoo.searchRead.mock.calls
    .filter((c) => c[0] === 'res.partner' && JSON.stringify(c[1]).includes('supplier_rank'))
    .map((c) => (c[1] as unknown[][])
      .filter((d) => Array.isArray(d) && d[0] === 'name' && d[1] === 'ilike')
      .map((d) => String(d[2]))
      .join(' '));
}

/** Có lượt tra NCC nào phủ MỌI từ của `ten` không (so trên bản bỏ dấu). */
function daTraTen(odoo: ReturnType<typeof fakeOdoo>, ten: string): boolean {
  const tu = boDau(ten).split(/\s+/).filter(Boolean);
  return luotTraNcc(odoo).some((luot) => {
    const co = boDau(luot);
    return tu.every((t) => co.includes(t));
  });
}

describe('ca thật 00:40–00:50 12/08 — máy gom đơn PHẢI tra nhà cung cấp đã trích được', () => {
  it('lượt 1 (00:40): đã nói "nhà cung cấp là Trung Quốc" → TRA NGAY, KHÔNG hỏi lại NCC', async () => {
    // Đây là chỗ đứt gốc. Lượt đầu đã có tên NCC trong tay mà máy vẫn hỏi
    // "Phiếu nhập này của nhà cung cấp nào ạ?" — nghĩa là `trich.khach` không
    // bao giờ được đắp vào phiên ở chế 'nhap', nên `buocTiepTheo` thấy
    // khachTuKhoa=null và rơi thẳng xuống nhánh hoi_thieu:'ncc'.
    const { goi, tinGui, odoo } = dungMay();

    const nhan = await goi(CAU_00_40);

    expect(nhan).toBe(true);
    // PHẢI có ít nhất một lần tra NCC sang Odoo ngay trong lượt này.
    expect(luotTraNcc(odoo).length).toBeGreaterThan(0);
    // Và tuyệt đối KHÔNG được hỏi lại thứ nhân viên vừa nói xong.
    expect(tinGui.join('\n')).not.toContain('của nhà cung cấp nào ạ');
  });

  it('lượt 2 (00:50) "ncc là Trung Quốc" → tra được, không đáp "chưa khớp"', async () => {
    const { goi, tinGui, odoo } = dungMay();

    await goi(CAU_00_40);
    await goi(CAU_00_50);

    expect(luotTraNcc(odoo).length).toBeGreaterThan(0);
    const tin = tinGui.join('\n');
    expect(tin).not.toContain('vẫn chưa khớp được');
    // Phải lộ ra NCC thật — chốt luôn hoặc in danh sách để chọn.
    expect(tin).toMatch(/NCC000001|NCC000290/);
  });

  it('"Trung Quốc" TRẦN khi đang chờ NCC → vẫn tra, dù model gọi là ngoại lệ', async () => {
    // Bước 3: model trả ngoaiLe=true cho câu ngắn không rõ nghĩa. Nhưng phiên
    // ĐANG CHỜ chính câu trả lời đó, nên "lạc đề" là câu trả lời tự mâu thuẫn —
    // giống hệt hàng rào đã dựng cho lệnh lên đơn rõ ràng và cho khối ảnh.
    const { goi, tinGui, odoo } = dungMay('c-tran');

    // Dựng đúng trạng thái "đang chờ NCC": lượt đầu KHÔNG kèm tên NCC.
    await goi(`tạo phiếu nhập hàng giúp tôi\n${KHOI_ANH}`);
    const nhan = await goi('Trung Quốc');

    // KHÔNG được nhường agent thường khi đang giữ phiên chờ trả lời.
    expect(nhan).toBe(true);
    expect(daTraTen(odoo, 'Trung Quốc')).toBe(true);
    expect(tinGui.join('\n')).toMatch(/NCC000001|NCC000290/);
  });

  it('câu hỏi lại KHÔNG được nói "danh sách trên" khi chưa từng in danh sách', async () => {
    // Ca 00:50:26: bot bảo "chọn SỐ THỨ TỰ trong danh sách trên" trong khi
    // chưa in danh sách nào. Nhân viên nhìn lên không thấy gì để chọn — đó là
    // hướng dẫn tới một chỗ không tồn tại.
    const { goi, tinGui } = dungMay('c-ds');

    // Lượt đầu không có NCC → bot hỏi NCC. Rồi gõ câu vô nghĩa hai lần để
    // guard chống-lặp bật lên đúng như ca thật.
    await goi(`tạo phiếu nhập hàng giúp tôi\n${KHOI_ANH}`);
    await goi('xyz không hiểu gì');
    await goi('xyz không hiểu gì nữa');

    for (const tin of tinGui) {
      if (/danh sách trên/i.test(tin)) {
        // Nếu có nói "danh sách trên" thì TRƯỚC đó phải thật sự có tin in danh
        // sách đánh số. Không có thì câu này sai ngữ cảnh.
        const truoc = tinGui.slice(0, tinGui.indexOf(tin));
        expect(truoc.some((t) => /^\s*1[).]/m.test(t))).toBe(true);
      }
    }
  });

  it('chế "len" (đơn bán) KHÔNG bị ảnh hưởng — vẫn tra KHÁCH như cũ', async () => {
    // Hàng rào mới chỉ được nới ở chế nhập. Chế lên đơn phải giữ nguyên hành vi.
    const { goi, odoo } = dungMay('c-len');

    await goi('lên đơn cho anh Trung Quốc 5 cái P10 full out');

    // Tra sang tập KHÁCH (customer_rank), tuyệt đối không phải supplier_rank.
    const traKhach = odoo.searchRead.mock.calls.filter(
      (c) => c[0] === 'res.partner' && !JSON.stringify(c[1]).includes('supplier_rank'));
    expect(traKhach.length).toBeGreaterThan(0);
  });
});
