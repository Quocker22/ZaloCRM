// SPDX-License-Identifier: AGPL-3.0-or-later
// KỊCH BẢN REPLAY — nguyên văn chat hỏng 23:15→23:16 ngày 11/08/2026.
//
//   23:15:49  NV : [Ảnh] "@bot tạo phiếu nhập hàng giúp tôi nhà cung cấp là Trung Quốc"
//   23:16:04  Bot: "Phiếu nhập này của nhà cung cấp nào ạ? (tên hoặc mã NCC)"
//   23:16:15  NV : "Nhà cung cấp Trung Quốc"
//   23:16:18  Bot: "Em vẫn chưa khớp được 'Nhà cung cấp Trung Quốc' với lựa chọn nào ạ.
//                   Anh/chị chọn SỐ THỨ TỰ ..., gõ SĐT hoặc mã KH của khách,
//                   nói 'khách mới' nếu khách chưa có, hoặc 'huỷ' để làm lại."
//   23:16:53  NV : "NCC000001"
//   23:16:56  Bot: "Phiếu nhập này của nhà cung cấp nào ạ? (tên hoặc mã NCC)"  ← quay lại đầu
//
// Anh Quốc: "ủa sao không tìm được nhà Cung cấp bạn dùng luôn tính năng tìm
// khách hàng áp dụng qua đi".
//
// BA LỖI, đã đo thật trên prod 11/08 (tài khoản bot_zalo, chỉ đọc):
//
//  (1) ODOO `ilike` KHÔNG BỎ DẤU — và câu NV còn dính nguyên tiền tố:
//        ['name','ilike','Trung Quốc']              -> 2 kq (314 NCC000001, 21 NCC000290)
//        ['name','ilike','trung quoc']              -> 0 kq   ← gõ không dấu là trượt sạch
//        ['name','ilike','Nhà cung cấp Trung Quốc'] -> 0 kq   ← chính câu 23:16:15
//      Lỗi không-bỏ-dấu là lỗi CHUNG, đo được ở cả ba tập:
//        khách  ['name','ilike','Thức'] -> 3 kq | ['name','ilike','Thuc'] -> 0 kq
//        SP     ['name','ilike','Nguồn']-> 5 kq | ['name','ilike','Nguon']-> 0 kq
//
//  (2) MÃ NCC KHÔNG ĐƯỢC NHẬN. `NCC000001` là ref hợp lệ của id=314 (đo:
//      ['ref','=ilike','NCC000001'] -> đúng 1 người), nhưng câu chọn của máy gom
//      đơn không nhận dạng mã này nên rơi xuống LLM và quay lại đầu luồng.
//
//  (3) CÂU HỎI LẠI DÙNG NGUYÊN VĂN CỦA LUỒNG KHÁCH — đang hỏi NHÀ CUNG CẤP mà
//      bot nói "mã KH của khách", "khách mới". Sai ngữ cảnh, và "khách mới" ở
//      đây vô nghĩa: bot KHÔNG được tự tạo NCC.
//
// Test này khoá cả ba, bằng ĐÚNG ba lượt thật ở trên.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** Câu nguyên văn 23:15:49 (tag @bot đã bị cổng nhận lệnh bóc trước khi tới máy). */
const CAU_23_15 = 'tạo phiếu nhập hàng giúp tôi nhà cung cấp là Trung Quốc';
/** Câu nguyên văn 23:16:15 — có TIỀN TỐ "Nhà cung cấp" dính vào tên. */
const CAU_23_16_15 = 'Nhà cung cấp Trung Quốc';
/** Câu nguyên văn 23:16:53 — mã NCC thật của id=314. */
const CAU_23_16_53 = 'NCC000001';

/**
 * `ilike` của Postgres, mô phỏng ĐÚNG hai tính chất quyết định ở đây:
 *   1. KHÔNG bỏ dấu — 'thuc' không khớp 'Thức' (đo prod 11/08).
 *   2. HIỂU ký tự đại diện `_` = đúng một ký tự bất kỳ, `%` = chuỗi bất kỳ.
 *
 * Tính chất (2) mới là thứ bản vá dựa vào: mẫu "tr_ng q__c" khớp được cả
 * "Trung Quốc" lẫn "trung quoc". Fake mà chỉ dùng String.includes() thì không
 * mô phỏng nổi và test sẽ đỏ oan.
 */
function ilike(mau: string, giaTri: string): boolean {
  // Dịch mẫu LIKE → regex: thoát mọi ký tự regex, rồi khôi phục `_` và `%`.
  // `\_` và `\%` (do người dùng gõ) giữ nguyên nghĩa chữ.
  let re = '';
  for (let i = 0; i < mau.length; i++) {
    const c = mau[i];
    if (c === '\\' && i + 1 < mau.length) { re += mau[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (c === '_') { re += '.'; continue; }
    if (c === '%') { re += '.*'; continue; }
    re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re, 'i').test(giaTri);
}

/**
 * Odoo giả MÔ PHỎNG ĐÚNG HÀNH VI THẬT: `ilike` KHÔNG bỏ dấu.
 *
 * Đây là điểm khác cốt tử so với fake ở replay-nhap-hang-11-08.ts (nó gọi boDau
 * cả hai vế nên vô tình che mất lỗi này). Muốn test bắt được bug thật thì fake
 * phải so CÓ DẤU y như Postgres prod.
 */
function fakeOdoo() {
  const ncc = [
    { id: 314, name: 'Trung Quốc', ref: 'NCC000001', supplier_rank: 5 },
    { id: 21, name: 'Trung Quốc- Kho Cô Lỳ', ref: 'NCC000290', supplier_rank: 2 },
  ];
  const khach = [{ id: 2519, name: 'TRung Quốc', ref: 'KH001046', supplier_rank: 0 }];
  const products = [
    { id: 901, name: 'Màn hình LED P10 full out', default_code: 'P10FO', list_price: 0, uom_id: [1, 'Tấm'] },
  ];

  const searchRead = vi.fn(async (model: string, domain: unknown[], _f: unknown, opts?: { limit?: number }) => {
    const s = JSON.stringify(domain);
    if (model === 'res.partner') {
      const theoId = (domain as unknown[][]).find((d) => Array.isArray(d) && d[0] === 'id' && d[1] === '=');
      if (theoId) return [...ncc, ...khach].filter((p) => p.id === Number(theoId[2]));

      const nguon = s.includes('supplier_rank') ? ncc : khach;

      // ref '=ilike' — khớp nguyên chuỗi, chỉ bỏ qua hoa/thường (đúng Odoo).
      const theoRef = (domain as unknown[][]).find(
        (d) => Array.isArray(d) && d[0] === 'ref' && d[1] === '=ilike');
      if (theoRef) {
        const m = String(theoRef[2]).toLowerCase();
        return nguon.filter((p) => (p.ref ?? '').toLowerCase() === m).slice(0, opts?.limit ?? 10);
      }

      // name 'ilike' — CÓ PHÂN BIỆT DẤU, chỉ bỏ qua hoa/thường. KHÔNG boDau!
      // Mẫu được bọc %…% vì Odoo dịch `ilike` thành LIKE '%giá trị%'.
      const tokens = (domain as unknown[][])
        .filter((d) => Array.isArray(d) && d[0] === 'name' && d[1] === 'ilike')
        .map((d) => String(d[2]));
      const khop = tokens.length > 0
        ? nguon.filter((p) => tokens.every((t) => ilike(`%${t}%`, p.name)))
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
        .map((d) => String(d[2]));
      return tokens.length > 0
        ? products.filter((p) => tokens.every((t) => ilike(`%${t}%`, p.name)))
        : products;
    }
    if (model === 'purchase.order') {
      if (s.includes('origin') && !s.includes('"id"')) return [];
      return [{ id: 7001, name: 'P04522', state: 'draft', amount_total: 0, origin: 'zalo:c-ncc:1' }];
    }
    return [];
  });

  return { searchRead, execute: vi.fn(async () => 7001) };
}

/** LLM giả: trích slot đúng như model thật đã làm ở ca 23:15. */
function fakeGenerate(): ToolAwareGenerate {
  return async (a) => {
    const nd = String(a.messages[0].content);
    let input: Record<string, unknown> = {};
    if (nd.includes('phiếu nhập hàng')) {
      // Model bóc được "Trung Quốc" từ câu đầu (có chữ "nhà cung cấp là").
      input = { nhapHang: true, khach: 'Trung Quốc', dong: [{ sp: 'P10 full out', sl: 100 }] };
    } else if (nd.includes('Nhà cung cấp Trung Quốc')) {
      // Lượt 23:16:15: model trả lại NGUYÊN VĂN cả tiền tố — đúng như thật.
      input = { khach: 'Nhà cung cấp Trung Quốc' };
    } else if (nd.includes('trung quoc')) {
      // Lượt gõ KHÔNG DẤU: model trả lại đúng thứ nhân viên gõ, KHÔNG tự thêm
      // dấu — đây mới là đầu vào thật mà tầng tra phải chịu được.
      input = { nhapHang: true, khach: 'trung quoc', dong: [{ sp: 'P10 full out', sl: 100 }] };
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
      orgId: 'o1', conversationId: 'c-ncc', seq: 1, cau, senderUid: 'uid-quoc',
    }),
    tinGui, odoo, db,
  };
}

describe('ca thật 23:15–23:16 11/08 — chọn được NHÀ CUNG CẤP', () => {
  it('lượt 23:16:15 "Nhà cung cấp Trung Quốc" → KHỚP được, không đáp câu chưa-khớp', async () => {
    // Lỗi cũ: tra nguyên cụm kèm tiền tố "Nhà cung cấp" → ilike 0 kết quả.
    const { goi, tinGui } = dungMay();

    await goi(CAU_23_15);
    await goi(CAU_23_16_15);

    const tin = tinGui.join('\n');
    expect(tin).not.toContain('vẫn chưa khớp được');
    // Phải ra được NCC thật: hoặc chốt luôn id 314, hoặc hiện danh sách 2 NCC.
    expect(tin).toMatch(/NCC000001|Trung Quốc/);
  });

  it('lượt 23:16:53 "NCC000001" → CHỐT ĐÚNG id=314, không quay lại hỏi từ đầu', async () => {
    // Lỗi cũ: apDungChon không nhận dạng mã NCC nên câu này rơi xuống LLM,
    // bot hỏi lại "Phiếu nhập này của nhà cung cấp nào ạ?" — quay về đầu luồng.
    const { goi, tinGui, odoo } = dungMay();

    await goi(CAU_23_15);
    await goi(CAU_23_16_15);
    await goi(CAU_23_16_53);

    // Không được hỏi lại câu mở đầu sau khi NV đã đưa mã chính xác.
    expect(tinGui[tinGui.length - 1]).not.toContain('của nhà cung cấp nào ạ');
    // Phiếu (nếu đã đủ slot) phải treo đúng NCC id=314, tuyệt đối không phải
    // khách hàng id=2519 "TRung Quốc".
    const create = odoo.execute.mock.calls.find((c) => c[1] === 'create');
    if (create) {
      const vals = (create[2] as unknown[])[0] as Record<string, unknown>;
      expect(vals.partner_id).toBe(314);
    }
  });

  it('gõ KHÔNG DẤU "trung quoc" → vẫn ra ĐÚNG 2 NCC thật', async () => {
    // Đo prod 11/08: ['name','ilike','trung quoc'] -> 0 kq, còn 'Trung Quốc'
    // -> 2 kq. Nhân viên gõ không dấu trên bàn phím điện thoại là chuyện thường
    // ngày; bắt họ bỏ dấu đúng mới dùng được bot là hỏng.
    //
    // Ở đây chỉ gõ MỘT lượt không dấu (không có lượt có dấu trước) để đo đúng
    // sức của mẫu không dấu, không nhờ vả kết quả lượt trước.
    const { goi, tinGui } = dungMay();

    await goi('tạo phiếu nhập hàng của trung quoc');

    const tin = tinGui.join('\n');
    // Phải ra đủ CẢ HAI nhà cung cấp thật — đúng bằng lượt gõ có dấu.
    expect(tin).toContain('NCC000001');
    expect(tin).toContain('NCC000290');
    expect(tin).not.toContain('không tìm thấy nhà cung cấp');
  });

  it('câu hỏi lại khi đang hỏi NCC KHÔNG được nhắc "khách"', async () => {
    // Lỗi (3): bot nói "gõ SĐT hoặc mã KH của khách", "nói khách mới" trong khi
    // đang hỏi NHÀ CUNG CẤP. "khách mới" còn vô nghĩa — bot không tạo NCC được.
    const { goi, tinGui } = dungMay();

    await goi(CAU_23_15);
    await goi(CAU_23_16_15);
    await goi('không hiểu gì cả xyz');

    for (const tin of tinGui) {
      if (/nhà cung cấp/i.test(tin)) {
        expect(tin).not.toMatch(/khách mới/i);
        expect(tin).not.toMatch(/mã KH của khách/i);
      }
    }
  });

  it('TUYỆT ĐỐI không tự tạo nhà cung cấp mới', async () => {
    // NCC gắn với điều khoản thanh toán, công nợ phải trả, mã số thuế — bot
    // tạo bừa là rác vĩnh viễn (bài học "khách rác Long" 11/08).
    const { goi, odoo } = dungMay();

    await goi(CAU_23_15);
    await goi(CAU_23_16_15);
    await goi(CAU_23_16_53);

    const taoPartner = odoo.execute.mock.calls.filter(
      (c) => c[0] === 'res.partner' && c[1] === 'create');
    expect(taoPartner).toHaveLength(0);
  });
});
