// SPDX-License-Identifier: AGPL-3.0-or-later
// KỊCH BẢN REPLAY — nguyên văn chat hỏng 16:15 11/08/2026 (nhóm, Minh Anh):
//
//   16:15:36  NV : 100 nguồn 5v60a không quạt giá 230k - lên đơn cho Anh long led nhé @bot
//   16:15:41  bot: Có 10 khách tên "Long": …(thiếu Anh Long Led)… chọn giúp em (vd: 1)
//   16:16:12  NV : Anh Long Led @bot
//   16:16:29  bot: (LẶP NGUYÊN VĂN danh sách 10 người)          ← bug
//
// Ba tầng lỗi: (1) LLM trích cắt "Led" khỏi tên; (2) tra khách cắt im lặng ở
// 10; (3) máy không có đường thoát — câu trả lời không map được ứng viên thì
// lặp lại y hệt. Test này khoá hành vi ĐÚNG của tầng 3 (và hint tầng 2 trong
// danh sách), với LLM giả CỐ TÌNH vẫn trích sai "Long" — tầng 3 phải cứu được
// cả khi tầng 1 thất bại.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import { boDau } from '../../../../src/modules/ai/odoo/tools/tra-san-pham.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** LLM giả — mô phỏng đúng lỗi thật: cả 2 lượt đều cắt "Led", trả "Long". */
function fakeGenerate(): ToolAwareGenerate {
  return async (a) => {
    const nd = String(a.messages[0].content);
    const input = nd.includes('lên đơn cho Anh long led')
      ? {
          lenDon: true,
          khach: 'Long', // ← trích SAI có chủ ý (tầng 1 thất bại)
          dong: [{ sp: 'nguồn 5v60a không quạt', sl: 100, gia: 230000 }],
        }
      : nd.includes('Anh Long Led')
        ? { khach: 'Long' } // ← lượt 2 vẫn cắt "Led"
        : {};
    return {
      text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't1', name: 'ghi_slot', input }],
    };
  };
}

/**
 * Odoo giả TÔN TRỌNG domain tên + limit — bắt buộc để tái hiện vụ cắt trang:
 * 11 khách khớp "long", "Anh Long Led" đứng CUỐI nên rơi khỏi trang đầu.
 */
function fakeOdoo() {
  const partners = [
    { id: 1, name: 'A Long. Thị xã kỳ anh. Hà tĩnh', ref: 'KH000882', phone: '0972772989' },
    { id: 2, name: 'Anh Công - QC Long Biên', ref: 'KH002412AC', phone: false },
    { id: 3, name: 'Anh Hoàng - CTCP Kim Khí Thăng Long', ref: 'KH002722AC', phone: '0977668973' },
    { id: 4, name: 'Anh Hoàng Huynh - Long Biên', ref: 'KH002712AC', phone: '0936206887' },
    { id: 5, name: 'Anh Hùng - QC Đa Hình Hạ Long', ref: 'KH000648-AC', phone: false },
    { id: 6, name: 'Anh Hạnh Long Biên', ref: 'KH001709', phone: false },
    { id: 7, name: 'Anh Kiên Long Biên', ref: 'KH000316', phone: false },
    { id: 8, name: 'Anh Long', ref: 'KH002649AC', phone: false },
    { id: 9, name: 'Anh Long - Dương Nội - Hà Đông', ref: 'KH002597AC', phone: '0854203758' },
    { id: 10, name: 'Anh Long - Hà Đông', ref: 'KH002210', phone: false },
    { id: 11, name: 'Anh Long Led', ref: 'KH003001', phone: '0911222333' }, // ← ngoài trang đầu
  ].map((p) => ({ ...p, mobile: false, incokit_receivable_balance: 0 }));

  const products = [
    { id: 3, name: 'Nguồn 5V60A Không Quạt', default_code: false, list_price: 230000, uom_id: [1, 'Cái'] },
  ];

  const searchRead = vi.fn(async (model: string, domain: unknown[], _f: unknown, opts?: { limit?: number }) => {
    if (model === 'res.partner') {
      const tokens = (domain as unknown[][])
        .filter((d) => Array.isArray(d) && d[0] === 'name' && d[1] === 'ilike')
        .map((d) => boDau(String(d[2])));
      const khop = tokens.length > 0
        ? partners.filter((p) => tokens.every((t) => boDau(p.name).includes(t)))
        : partners;
      return khop.slice(0, opts?.limit ?? khop.length);
    }
    if (model === 'product.product') {
      // traSanPham hỏi HAI lần (có giá / trống giá) — fake phải tôn trọng điều
      // kiện list_price, không thì cùng một SP xuất hiện hai lần thành "2 loại".
      const dkGia = (domain as unknown[][]).find(
        (d) => Array.isArray(d) && d[0] === 'list_price',
      );
      if (dkGia?.[1] === '>') return products.filter((p) => p.list_price > Number(dkGia[2]));
      if (dkGia?.[1] === '<=') return products.filter((p) => p.list_price <= Number(dkGia[2]));
      return products;
    }
    if (model === 'sale.order') return [];
    return [];
  });
  const execute = vi.fn(async () => 777);
  return { searchRead, execute };
}

function fakeDb() {
  const rows = new Map<string, { orgId: string; conversationId: string; slots: unknown; hetHan: Date }>();
  return {
    phienGomDon: {
      findUnique: async ({ where }: { where: { conversationId: string } }) =>
        rows.get(where.conversationId) ?? null,
      upsert: async ({ where, create, update }: {
        where: { conversationId: string }; create: never; update: { slots: unknown; hetHan: Date };
      }) => {
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
  const tinGui: string[] = [];
  const deps: GomDonDeps = {
    prisma: fakeDb() as never,
    odoo: odoo as never,
    generate: fakeGenerate(),
    anhClient: null,
    odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {},
    ghiLog: () => {},
  };
  const goi = (cau: string) =>
    xuLyGomDon(deps, { orgId: 'o1', conversationId: 'c1', seq: 1, cau });
  return { goi, tinGui, odoo };
}

const CAU_LUOT_1 = '100 nguồn 5v60a không quạt giá 230k - lên đơn cho Anh long led nhé';

describe('replay 16:15 11/08 — "Anh Long Led" ngoài trang đầu danh sách', () => {
  it('lượt 1: danh sách 10 người + nói RÕ danh sách chưa đủ (tầng 2)', async () => {
    const m = dungMay();

    expect(await m.goi(CAU_LUOT_1)).toBe(true);
    expect(m.tinGui).toHaveLength(1);
    expect(m.tinGui[0]).toContain('10 khách tên "Long"');
    expect(m.tinGui[0]).not.toContain('Anh Long Led');
    // Tầng 2: KHÔNG được cắt im lặng — phải nói còn nữa + cách thu hẹp.
    expect(m.tinGui[0]).toMatch(/chưa đủ|còn khách/i);
    expect(m.tinGui[0]).toMatch(/đầy đủ hơn|SĐT/i);
  });

  it('lượt 2 "Anh Long Led": TRA LẠI với tên đầy đủ, chốt đúng người — không lặp danh sách (tầng 3)', async () => {
    const m = dungMay();
    await m.goi(CAU_LUOT_1);

    expect(await m.goi('Anh Long Led')).toBe(true);
    expect(m.tinGui).toHaveLength(2);
    // KHÔNG lặp nguyên văn danh sách.
    expect(m.tinGui[1]).not.toBe(m.tinGui[0]);
    expect(m.tinGui[1]).not.toContain('chọn giúp em');
    // Máy tra lại bằng "Long Led" → ra đúng một người → tóm tắt chờ chốt.
    expect(m.tinGui[1]).toContain('Anh Long Led');
    expect(m.tinGui[1]).toContain('100 × Nguồn 5V60A Không Quạt');
    expect(m.tinGui[1]).toContain('230.000');
  });

  it('câu không map được và KHÔNG có từ khoá mới ("9999") → đổi lời, không lặp nguyên văn', async () => {
    const m = dungMay();
    await m.goi(CAU_LUOT_1);

    expect(await m.goi('9999')).toBe(true);
    expect(m.tinGui).toHaveLength(2);
    expect(m.tinGui[1]).not.toBe(m.tinGui[0]);
    expect(m.tinGui[1]).toMatch(/chưa khớp/i);
    // Câu hướng dẫn ngắn phải chỉ đường thoát: số thứ tự / SĐT / mã KH / khách mới.
    expect(m.tinGui[1]).toMatch(/SĐT|mã KH/);
    expect(m.tinGui[1]).toMatch(/khách mới/);
  });
});

describe('tachTenRoHon — cố ý HẸP, thà bỏ sót còn hơn tra bừa', () => {
  it('nhận: tên chứa từ khoá cũ + dài hơn, bỏ xưng hô/đuôi lịch sự', async () => {
    const { tachTenRoHon } = await import(
      '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js'
    );
    expect(tachTenRoHon('Anh Long Led', 'Long')).toBe('Long Led');
    expect(tachTenRoHon('anh long led nhé', 'Long')).toBe('long led');
    expect(tachTenRoHon('Long Dương Nội ạ', 'Long')).toBe('Long Dương Nội');
  });

  it('từ chối: số, câu dài, không chứa từ khoá cũ, y hệt từ khoá cũ', async () => {
    const { tachTenRoHon } = await import(
      '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js'
    );
    expect(tachTenRoHon('9999', 'Long')).toBeNull();
    expect(tachTenRoHon('Long', 'Long')).toBeNull();
    expect(tachTenRoHon('anh Long', 'Long')).toBeNull();
    expect(tachTenRoHon('không thấy đúng người nào cả luôn á em ơi', 'Long')).toBeNull();
    expect(tachTenRoHon('Hùng Đèn', 'Long')).toBeNull();
  });
});
