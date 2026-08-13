// SPDX-License-Identifier: AGPL-3.0-or-later
// KỊCH BẢN REPLAY — hợp đồng hành vi của máy gom đơn.
//
// Kịch bản #1 là NGUYÊN VĂN chat hỏng 21:07 07/08/2026 (bot hỏi lại SL đã có,
// lặp y hệt câu hỏi, lượt 3 mới tra khách). Máy trạng thái phải cho ra hành vi
// đúng: tra song song lượt 1, hỏi gộp MỘT tin, không bao giờ hỏi SL đã có.
// Mỗi bug thật về sau = thêm một kịch bản ở đây.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** LLM giả: map câu nhân viên → kết quả trích slot dựng sẵn. */
function fakeGenerate(): { g: ToolAwareGenerate; soLanGoi: () => number } {
  let n = 0;
  const g: ToolAwareGenerate = async (a) => {
    n++;
    const nd = String(a.messages[0].content);
    const input = nd.includes('lên đơn cho anh Hưng 10 cái nguồn NB')
      ? { khach: 'Hưng', dong: [{ sp: 'nguồn NB', sl: 10 }] }
      : nd.includes('tồn kho NB còn nhiêu')
        ? { ngoaiLe: true }
        : nd.includes('thôi huỷ đi')
          ? { huy: true }
          : nd.includes('"ok"')
            ? { xacNhan: true }
            : { ngoaiLe: true };
    return { text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't1', name: 'ghi_slot', input }] };
  };
  return { g, soLanGoi: () => n };
}

/** Odoo giả: 2 khách tên Hưng, 2 SP "Nguồn NB", tạo đơn ra S13888. */
function fakeOdoo() {
  // Domain Odoo = mảng phần tử: '&'/'|' hoặc bộ ba [field, op, value].
  const layDk = (domain: unknown[], f: string, op: string) =>
    (domain.find((d) => Array.isArray(d) && d[0] === f && d[1] === op) as unknown[] | undefined)?.[2];
  const coDk = (domain: unknown[], f: string, op: string) => layDk(domain, f, op) !== undefined;

  const partners = [
    { id: 7, name: 'Hưng Cty A', ref: 'KH001017', phone: '0901234567', mobile: false, incokit_receivable_balance: 0 },
    { id: 8, name: 'Trần Hưng', ref: 'KH000022', phone: '0987654321', mobile: false, incokit_receivable_balance: 0 },
  ];
  const products = [
    { id: 3, name: 'Nguồn NB 12V100W', default_code: false, list_price: 185000, uom_id: [1, 'Cái'] },
    { id: 4, name: 'Nguồn NB 24V200W', default_code: false, list_price: 320000, uom_id: [1, 'Cái'] },
  ];

  const searchRead = vi.fn(async (model: string, domain: unknown[]) => {
    if (model === 'res.partner') {
      const id = layDk(domain, 'id', '=');
      if (id != null) return partners.filter((p) => p.id === Number(id));
      return partners; // tra theo tên "Hưng" → cả hai
    }
    if (model === 'product.product') {
      const ids = layDk(domain, 'id', 'in') as number[] | undefined;
      if (ids) return products.filter((p) => ids.includes(p.id));
      return products; // tra "nguồn NB" → cả hai loại
    }
    if (model === 'sale.order') {
      if (coDk(domain, 'id', '=')) {
        return [{ id: 555, name: 'S13888', amount_total: 1850000, state: 'draft', create_date: '2026-08-07 14:30:00' }];
      }
      return []; // chưa có đơn trùng khoá / liền kề
    }
    return [];
  });
  const execute = vi.fn(async () => 555);
  return { searchRead, execute };
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
      deleteMany: async ({ where }: { where: { conversationId: string } }) => {
        rows.delete(where.conversationId);
        return { count: 1 };
      },
    },
  };
}

function dungMay() {
  const odoo = fakeOdoo();
  const db = fakeDb();
  const { g, soLanGoi } = fakeGenerate();
  const tinGui: string[] = [];
  const log: Array<{ toolName: string; thanhCong: boolean }> = [];
  const deps: GomDonDeps = {
    prisma: db as never,
    odoo: odoo as never,
    generate: g,
    anhClient: null,
    odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {},
    ghiLog: (l) => log.push({ toolName: l.toolName, thanhCong: l.thanhCong }),
  };
  const goi = (cau: string) =>
    xuLyGomDon(deps, { orgId: 'o1', conversationId: 'c1', seq: 1, cau });
  return { goi, tinGui, odoo, db, log, soLanGoi };
}

describe('replay chat 21:07 07/08 — lên đơn anh Hưng 10 cái nguồn NB', () => {
  // 11/08: kịch bản này rút từ 4 lượt xuống 3. Anh Quốc bỏ bước chốt ("nếu mọi
  // thứ đã rõ ràng thì lên đơn báo giá luôn") nên lượt "ok" cuối cùng biến mất:
  // chọn "1a" xong là đủ thông tin → đơn lên ngay trong chính lượt đó.
  it('kịch bản #1: 3 lượt ra đơn, không một lần hỏi lại SL', async () => {
    const m = dungMay();

    // Lượt 1: câu đầy đủ → tra song song → MỘT tin hỏi gộp khách + SP
    expect(await m.goi('lên đơn cho anh Hưng 10 cái nguồn NB nhé')).toBe(true);
    expect(m.tinGui).toHaveLength(1);
    expect(m.tinGui[0]).toContain('1) Hưng Cty A · KH001017 · 0901234567');
    expect(m.tinGui[0]).toContain('a) Nguồn NB 12V100W · 185.000đ');
    const traKhach = m.odoo.searchRead.mock.calls.filter((c) => c[0] === 'res.partner');
    const traSp = m.odoo.searchRead.mock.calls.filter((c) => c[0] === 'product.product');
    expect(traKhach.length).toBeGreaterThan(0);
    expect(traSp.length).toBeGreaterThan(0);
    expect(m.log.map((l) => l.toolName)).toEqual(
      expect.arrayContaining(['tra_khach_hang', 'tra_san_pham']),
    );

    // Lượt 2: nhắn lại Y NGUYÊN → vẫn danh sách chọn, KHÔNG tạo phiên mới
    expect(await m.goi('lên đơn cho anh Hưng 10 cái nguồn NB nhé')).toBe(true);
    expect(m.tinGui[1]).toContain('1) Hưng Cty A');

    // Lượt 3: "1a" → ĐỦ THÔNG TIN nên tạo đơn LUÔN, không hỏi chốt nữa.
    // Map "1a" bằng CODE, không tốn lượt LLM.
    const llmTruoc = m.soLanGoi();
    expect(await m.goi('1a')).toBe(true);
    expect(m.soLanGoi()).toBe(llmTruoc);
    expect(m.odoo.execute).toHaveBeenCalledTimes(1);
    const donTao = m.odoo.execute.mock.calls[0] as unknown[];
    expect(donTao[0]).toBe('sale.order');
    const payload = (donTao[2] as Array<Record<string, unknown>>)[0];
    expect(payload.partner_id).toBe(7);

    // Tin cuối: tóm tắt (nội dung GIỮ NGUYÊN) + đơn đã lên + link.
    expect(m.tinGui[2]).toContain('10 × Nguồn NB 12V100W');
    expect(m.tinGui[2]).toContain('1.850.000đ');
    expect(m.tinGui[2]).toContain('S13888');
    expect(m.tinGui[2]).toContain('https://odoo.example.com'); // link xử lý
    // Đơn xong: phiên GOM chết, nhưng để lại DẤU đơn-vừa-lên (13/08 — câu
    // "giá 1800 đó" ngay sau đó phải biết mình nói về đơn nào).
    const luu = m.db.rows.get('c1')?.slots as { dong?: unknown[]; daXong?: { maDon: string } } | undefined;
    expect(luu?.dong ?? []).toHaveLength(0);
    expect(luu?.daXong?.maDon).toBe('S13888');

    // Hợp đồng số 1: KHÔNG lượt nào hỏi "bao nhiêu" — SL có từ câu đầu
    expect(m.tinGui.join('\n')).not.toMatch(/bao nhiêu/i);
    // Hợp đồng MỚI 11/08: không một lượt nào rủ chốt
    expect(m.tinGui.join('\n')).not.toMatch(/chốt lên đơn/i);
  });

  it('kịch bản #2: digression giữa chừng → nhường agent thường, phiên GIỮ NGUYÊN', async () => {
    const m = dungMay();
    await m.goi('lên đơn cho anh Hưng 10 cái nguồn NB nhé');
    expect(await m.goi('tồn kho NB còn nhiêu?')).toBe(false); // máy không nhận
    expect(m.db.rows.has('c1')).toBe(true);                    // phiên còn
    expect(await m.goi('1a')).toBe(true);                      // quay lại chọn tiếp
    expect(m.tinGui[1]).toContain('10 × Nguồn NB 12V100W');
  });

  it('kịch bản #3: "thôi huỷ đi" → xác nhận huỷ, phiên xoá', async () => {
    const m = dungMay();
    await m.goi('lên đơn cho anh Hưng 10 cái nguồn NB nhé');
    expect(await m.goi('thôi huỷ đi')).toBe(true);
    expect(m.tinGui[1].toLowerCase()).toContain('huỷ');
    expect(m.db.rows.has('c1')).toBe(false);
    expect(m.odoo.execute).not.toHaveBeenCalled();
  });

  // ĐỔI LUẬT 10/08: trước đây máy từ chối NGAY khi regex không khớp, không tốn
  // lượt LLM nào. Nhưng chính đó làm bot bỏ sót "lên cho anh Huấn khách mới 10
  // nguồn NB nhé" (bug 22:09) — regex đòi "lên"+"đơn" dính nhau.
  //
  // Giờ regex trượt thì HỎI LLM một lượt rồi mới quyết. Đánh đổi: mỗi câu
  // không-phải-lên-đơn tốn thêm ~1 lượt trích slot (~1k token, rẻ hơn nhiều so
  // với để nhân viên phải gõ lại đúng cú pháp). Máy VẪN nhường đúng — chỉ là
  // biết nhường sau khi hỏi, thay vì đoán mò bằng chữ.
  it('không phải lệnh lên đơn và không có phiên → máy NHƯỜNG (sau khi hỏi LLM)', async () => {
    const m = dungMay();
    expect(await m.goi('doanh thu tháng này bao nhiêu?')).toBe(false);
    // Có hỏi LLM đúng MỘT lượt — không hỏi hai lần cho cùng một câu.
    expect(m.soLanGoi()).toBe(1);
    // Nhường thì tuyệt đối không nhắn gì, để agent thường trả lời.
    expect(m.tinGui).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bug thật 23:13-23:17 07/08 — quote-reply Zalo nhét cả tin được quote vào câu:
//   `[Trả lời tin: "Có 10 khách tên "Tuấn":…"] 5`
// Máy không map nổi "5" trong đống đó → nhường agent thường → đơn tạo KHÔNG
// qua cổng chốt. Và "xuất hóa đơn luôn giúp tôi nhé" bị dò mảnh chốt nhầm
// khách hiệp hoà → S13814 sai người (đã huỷ tay 23:25).
describe('replay 23:13 07/08 — quote-reply và câu xuất hoá đơn', () => {
  it('quote-reply "1a" vẫn chốt bằng CODE, ra tóm tắt, không tốn lượt LLM', async () => {
    const m = dungMay();
    await m.goi('lên đơn cho anh Hưng 10 cái nguồn NB nhé');
    const llmTruoc = m.soLanGoi();
    const quote = '[Trả lời tin: "Có 2 khách tên "Hưng":\n1) Hưng Cty A · KH001017 · 0901234567\n2) Trần Hưng"] 1a';
    expect(await m.goi(quote)).toBe(true);
    expect(m.soLanGoi()).toBe(llmTruoc);            // map bằng code, không LLM
    expect(m.tinGui[1]).toContain('10 × Nguồn NB 12V100W');
    expect(m.tinGui[1]).toContain('1.850.000đ');
  });

  it('"xuất hóa đơn luôn giúp tôi nhé" giữa phiên → nhường agent thường, KHÔNG chốt bừa khách', async () => {
    const m = dungMay();
    await m.goi('lên đơn cho anh Hưng 10 cái nguồn NB nhé');
    expect(await m.goi('xuất hóa đơn luôn giúp tôi nhé')).toBe(false); // agent thường xử
    const phien = m.db.rows.get('c1');
    const slots = phien?.slots as { khachDaChot?: unknown };
    expect(slots.khachDaChot).toBeUndefined();       // không ai bị chốt oan
    expect(m.odoo.execute).not.toHaveBeenCalled();
  });

  it('quote chứa chữ "lên đơn" của tin bot KHÔNG tự mở phiên mới', async () => {
    const m = dungMay();
    const cau = '[Trả lời tin: "Đã lên đơn nháp S13813 cho khách…"] xem tồn kho giúp';
    expect(await m.goi(cau)).toBe(false);
    expect(m.db.rows.has('c1')).toBe(false);
  });
});
