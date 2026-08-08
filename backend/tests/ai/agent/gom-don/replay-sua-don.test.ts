// SPDX-License-Identifier: AGPL-3.0-or-later
// KỊCH BẢN SỬA ĐƠN qua máy trạng thái (spec 2026-08-08).
//
// Hợp đồng anh Quốc chốt: RÕ thì ghi thẳng (không hỏi chốt như lên đơn), MƠ HỒ
// chỗ nào hỏi đúng chỗ đó. Tool sua_don không đổi — máy chỉ quyết gọi với gì.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** LLM giả: map câu → slot trích sẵn (có cờ sua). */
function fakeGenerate(): { g: ToolAwareGenerate; soLanGoi: () => number } {
  let n = 0;
  const g: ToolAwareGenerate = async (a) => {
    n++;
    const nd = String(a.messages[0].content);
    const input = nd.includes('thêm 1000 cáp 16 sợi nhỏ')
      ? { sua: true, dong: [{ sp: 'cáp 16 sợi nhỏ', sl: 1000 }] }
      : nd.includes('sửa đơn thêm 5 cáp')
        ? { sua: true, dong: [{ sp: 'cáp', sl: 5 }] }
        : nd.includes('sửa đơn S13821')
          ? { sua: true, maDon: 'S13821', dong: [{ sp: 'cáp 16 sợi nhỏ', sl: 5 }] }
          : nd.includes('sửa đơn')
            ? { sua: true }
            : { ngoaiLe: true };
    return { text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't1', name: 'ghi_slot', input }] };
  };
  return { g, soLanGoi: () => n };
}

/**
 * Odoo giả. `donNhap` = danh sách đơn nháp của hội thoại; `spTraVe` = kết quả
 * tra sản phẩm (1 hoặc nhiều để test nhánh chọn).
 */
function fakeOdoo(opts: {
  donNhap?: Array<{ id: number; name: string; amount_total: number; state?: string }>;
  spNhieu?: boolean;
} = {}) {
  const donNhap = opts.donNhap ?? [
    { id: 26737, name: 'S13820', amount_total: 1070000, state: 'draft' },
  ];
  // Kho SP: "cáp 16 sợi nhỏ" luôn khớp DUY NHẤT một SP; chỉ từ khoá cụt "cáp"
  // mới ra nhiều (giống Odoo thật) — nhờ vậy test được cả hai nhánh mà không
  // cần cờ giả tạo.
  const nho = { id: 1051, name: 'cáp 16 sợi nhỏ (cuộn)', default_code: false, list_price: 170000, uom_id: [1, 'Cuộn'] };
  const to = { id: 1052, name: 'cáp 16 sợi to (cuộn)', default_code: false, list_price: 250000, uom_id: [1, 'Cuộn'] };
  const products = opts.spNhieu ? [nho, to] : [nho];

  const layDk = (domain: unknown[], f: string, op: string) =>
    (domain.find((d) => Array.isArray(d) && d[0] === f && d[1] === op) as unknown[] | undefined)?.[2];

  const searchRead = vi.fn(async (model: string, domain: unknown[]) => {
    if (model === 'product.product') {
      const ids = layDk(domain, 'id', 'in') as number[] | undefined;
      if (ids) return products.filter((p) => ids.includes(p.id));
      // traSanPham gửi domain ['name','ilike',<từ>] nối AND ('&'), và nếu lượt
      // đó rỗng thì NỚI thành OR ('|') — fake phải tôn trọng cả hai, nếu không
      // "cáp 16 sợi nhỏ" rơi xuống nhánh OR và khớp luôn "cáp 16 sợi to".
      const tuKhoa = (domain as unknown[])
        .filter((d): d is [string, string, string] =>
          Array.isArray(d) && d[0] === 'name' && d[1] === 'ilike' && typeof d[2] === 'string')
        .map((d) => d[2].toLowerCase().replace(/%/g, ''));
      if (tuKhoa.length === 0) return products;
      // Lượt AND vẫn có một '|' ở đầu (nhánh default_code) — dấu hiệu phân biệt
      // là có '&' hay không.
      const laOr = !(domain as unknown[]).includes('&');
      // traSanPham tra HAI lượt: giá thật (list_price > 10) rồi giá ảo (<= 10).
      // Fake phải tôn trọng, nếu không cùng một SP trả về ở cả hai lượt và tool
      // tưởng có 2 sản phẩm khác nhau.
      const giaTren = (domain as unknown[]).find(
        (d): d is [string, string, number] => Array.isArray(d) && d[0] === 'list_price');
      return products.filter((p) => {
        if (giaTren) {
          const [, op, nguong] = giaTren;
          if (op === '>' && !(p.list_price > Number(nguong))) return false;
          if (op === '<=' && !(p.list_price <= Number(nguong))) return false;
        }
        const ten = p.name.toLowerCase();
        return laOr ? tuKhoa.some((t) => ten.includes(t)) : tuKhoa.every((t) => ten.includes(t));
      });
    }
    if (model === 'sale.order') {
      const id = layDk(domain, 'id', '=');
      if (id != null) return donNhap.filter((d) => d.id === Number(id)).map((d) => ({ ...d, create_date: '2026-08-08 03:00:00' }));
      const ma = layDk(domain, 'name', '=');
      if (ma != null) return donNhap.filter((d) => d.name === ma).map((d) => ({ ...d, create_date: '2026-08-08 03:00:00' }));
      // tra theo khoá hội thoại
      return donNhap.map((d) => ({ ...d, create_date: '2026-08-08 03:00:00' }));
    }
    if (model === 'sale.order.line') return [];
    return [];
  });
  const execute = vi.fn(async () => 1);
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

function dungMay(odooOpts: Parameters<typeof fakeOdoo>[0] = {}) {
  const odoo = fakeOdoo(odooOpts);
  const db = fakeDb();
  const { g, soLanGoi } = fakeGenerate();
  const tinGui: string[] = [];
  const log: Array<{ toolName: string }> = [];
  const deps: GomDonDeps = {
    prisma: db as never,
    odoo: odoo as never,
    generate: g,
    anhClient: null,
    odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {},
    ghiLog: (l) => log.push({ toolName: l.toolName }),
  };
  const goi = (cau: string) =>
    xuLyGomDon(deps, { orgId: 'o1', conversationId: 'c1', seq: 1, cau });
  return { goi, tinGui, odoo, db, log, soLanGoi };
}

describe('sửa đơn — đủ rõ thì ghi thẳng', () => {
  it('một đơn nháp + SP khớp duy nhất → gọi sua_don NGAY, không hỏi gì', async () => {
    const m = dungMay();
    expect(await m.goi('sửa đơn thêm 1000 cáp 16 sợi nhỏ')).toBe(true);

    // Đã ghi Odoo trong chính lượt này
    const goiGhi = m.odoo.execute.mock.calls.filter((c) => c[0] === 'sale.order.line');
    expect(goiGhi.length).toBeGreaterThan(0);
    expect(m.log.map((l) => l.toolName)).toContain('sua_don');

    // Báo bằng số thật, có mã đơn
    expect(m.tinGui[0]).toContain('S13820');
    // KHÔNG hỏi chốt
    expect(m.tinGui.join('\n')).not.toMatch(/em sửa nhé|chốt/i);
    // Phiên xoá sau khi xong
    expect(m.db.rows.has('c1')).toBe(false);
  });

  it('nói rõ mã đơn → dùng đúng đơn đó', async () => {
    const m = dungMay({ donNhap: [
      { id: 26737, name: 'S13820', amount_total: 1070000, state: 'draft' },
      { id: 26738, name: 'S13821', amount_total: 780000, state: 'draft' },
    ] });
    expect(await m.goi('sửa đơn S13821 thêm 5 cáp 16 sợi nhỏ')).toBe(true);
    expect(m.tinGui[0]).toContain('S13821');
    expect(m.tinGui[0]).not.toContain('S13820');
  });
});

describe('sửa đơn — mơ hồ chỗ nào hỏi chỗ đó', () => {
  it('nhiều SP khớp → liệt kê cho chọn, KHÔNG ghi Odoo', async () => {
    const m = dungMay({ spNhieu: true });
    expect(await m.goi('sửa đơn thêm 5 cáp')).toBe(true);
    expect(m.tinGui[0]).toContain('a) cáp 16 sợi nhỏ');
    expect(m.tinGui[0]).toContain('b) cáp 16 sợi to');
    expect(m.odoo.execute).not.toHaveBeenCalled();

    // Chọn "a" → giờ mới ghi
    expect(await m.goi('a')).toBe(true);
    expect(m.odoo.execute).toHaveBeenCalled();
    expect(m.tinGui[1]).toContain('S13820');
  });

  it('hai đơn nháp → liệt kê ĐƠN cho chọn trước, chưa ghi', async () => {
    const m = dungMay({ donNhap: [
      { id: 26737, name: 'S13820', amount_total: 1070000, state: 'draft' },
      { id: 26738, name: 'S13821', amount_total: 780000, state: 'draft' },
    ] });
    expect(await m.goi('sửa đơn thêm 1000 cáp 16 sợi nhỏ')).toBe(true);
    expect(m.tinGui[0]).toContain('1) S13820');
    expect(m.tinGui[0]).toContain('2) S13821');
    expect(m.odoo.execute).not.toHaveBeenCalled();
  });

  it('không có đơn nháp nào → báo rõ, không nổ, không ghi', async () => {
    const m = dungMay({ donNhap: [] });
    expect(await m.goi('sửa đơn thêm 1000 cáp 16 sợi nhỏ')).toBe(true);
    expect(m.tinGui[0].toLowerCase()).toContain('không thấy');
    expect(m.odoo.execute).not.toHaveBeenCalled();
  });

  it('chỉ nói "sửa đơn" trống → hỏi sửa gì, kèm mã đơn đã biết', async () => {
    const m = dungMay();
    expect(await m.goi('sửa đơn')).toBe(true);
    expect(m.tinGui[0]).toContain('S13820');
    expect(m.odoo.execute).not.toHaveBeenCalled();
  });
});

describe('ranh giới — không giẫm luồng lên đơn', () => {
  it('câu "lên đơn" vẫn vào chế lên đơn (hỏi khách), không thành sửa', async () => {
    const m = dungMay();
    // fakeGenerate trả ngoaiLe cho câu này → máy nhường agent thường,
    // nhưng quan trọng là KHÔNG rơi vào nhánh sửa đơn.
    await m.goi('lên đơn cho anh Hưng 10 cái nguồn NB');
    expect(m.log.map((l) => l.toolName)).not.toContain('sua_don');
  });
});
