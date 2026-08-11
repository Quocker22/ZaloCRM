// SPDX-License-Identifier: AGPL-3.0-or-later
// KỊCH BẢN SỬA ĐƠN qua máy trạng thái (spec 2026-08-08).
//
// Hợp đồng anh Quốc chốt: RÕ thì ghi thẳng (không hỏi chốt như lên đơn), MƠ HỒ
// chỗ nào hỏi đúng chỗ đó. Tool sua_don không đổi — máy chỉ quyết gọi với gì.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';
import { ilikeChua } from '../../odoo/ilike-gia.js';

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
        // GIỮ NGUYÊN mẫu (kể cả '_' và '%') — từ 11/08 traSanPham tra bằng mẫu
        // KHÔNG DẤU dùng '_', bóc đi là fake không khớp nổi (xem ilike-gia.ts).
        .map((d) => d[2]);
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
        return laOr
          ? tuKhoa.some((t) => ilikeChua(t, p.name))
          : tuKhoa.every((t) => ilikeChua(t, p.name));
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

// ═══════════════════════════════════════════════════════════════════════════
// REPLAY DEMO NHÓM 17:00-17:23 10/08 — phiên kẹt vì SP giá 1đ.
// Bug gốc: 5 lệnh liên tiếp (kể cả "lên đơn cho anh Hoàng" — khách khác hẳn)
// đều trả ĐÚNG MỘT câu lỗi cũ về Led thanh tỏa.
describe('replay 10/08 — gỡ phiên kẹt vì SP chưa có giá', () => {
  function mayGiaAo() {
    const nho = { id: 1037, name: 'Nguồn NB Ngoài Trời 12V400W (cái)', default_code: false, list_price: 132000, uom_id: [1, 'Cái'] };
    const ao = { id: 1922, name: 'Led thanh tỏa Lixin 220V Ngoài Trời Màu Trắng', default_code: false, list_price: 1, uom_id: [1, 'Thanh'] };
    const partners = [{ id: 27, name: 'Anh Vấn Đà Nẵng', ref: 'KH000027', phone: '0934786998', mobile: false, incokit_receivable_balance: 0 }];
    const searchRead = vi.fn(async (model: string, domain: unknown[]) => {
      if (model === 'res.partner') return partners;
      if (model === 'product.product') {
        // Tra theo ID: cổng kiểm giá lúc tạo đơn hỏi ['id','in',[...]]. Fake
        // phải lọc đúng, nếu không nó trả CẢ SP đã bị bỏ ra khỏi đơn và cổng
        // báo lỗi giá 1đ cho một dòng không còn tồn tại.
        const dkId = (domain as unknown[]).find(
          (d): d is [string, string, unknown] => Array.isArray(d) && d[0] === 'id');
        if (dkId) {
          const ids = Array.isArray(dkId[2]) ? (dkId[2] as number[]) : [Number(dkId[2])];
          return [nho, ao].filter((p) => ids.includes(p.id)).map((p) => ({ ...p, active: true }));
        }
        const tu = (domain as unknown[])
          .filter((d): d is [string,string,string] => Array.isArray(d) && d[0]==='name' && d[1]==='ilike')
          .map((d) => String(d[2]));
        const gia = (domain as unknown[]).find((d): d is [string,string,number] => Array.isArray(d) && d[0]==='list_price');
        return [nho, ao].filter((p) => {
          if (gia) {
            const [, op, ng] = gia;
            if (op === '>' && !(p.list_price > Number(ng))) return false;
            if (op === '<=' && !(p.list_price <= Number(ng))) return false;
          }
          return tu.length === 0 || tu.every((t) => ilikeChua(t, p.name));
        });
      }
      if (model === 'sale.order') {
        // Đơn vừa tạo: taoDonNhap đọc lại để xác nhận state='draft'.
        const coId = (domain as unknown[]).some((d) => Array.isArray(d) && d[0] === 'id');
        return coId ? [{ id: 999, name: 'S13900', amount_total: 3600000, state: 'draft' }] : [];
      }
      return [];
    });
    const execute = vi.fn(async () => 999);
    const db = fakeDb();
    const tinGui: string[] = [];
    const g: ToolAwareGenerate = async (a) => {
      const nd = String(a.messages[0].content);
      const input = /Câu nhân viên: "chốt"/.test(nd)
        ? { xacNhan: true }
        : nd.includes('10 cái nguồn NB 12V400W x 170k') && nd.includes('300 thanh led tỏa')
        ? { khach: 'Vấn', dong: [
            { sp: 'nguồn NB 12V400W', sl: 10, gia: 170000 },
            { sp: 'led thanh tỏa Lixin', sl: 300, gia: 13000 }] }
        : nd.includes('10 cái nguồn NB 12V400W') && nd.includes('300 thanh led tỏa')
          ? { khach: 'Vấn', dong: [
              { sp: 'nguồn NB 12V400W', sl: 10 },
              { sp: 'led thanh tỏa Lixin', sl: 300 }] }
          : nd.includes('bỏ 300 thanh led tỏa')
            ? { boDong: ['led thanh tỏa'] }
            : nd.includes('lên đơn cho anh Hoàng')
              ? { khach: 'Hoàng', dong: [{ sp: 'nguồn NB 12V400W', sl: 10 }] }
              : { ngoaiLe: true };
      return { text: '', stopReason: 'tool_use', raw: null,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        toolCalls: [{ id: 't1', name: 'ghi_slot', input }] };
    };
    const deps: GomDonDeps = {
      prisma: db as never, odoo: { searchRead, execute } as never, generate: g,
      anhClient: null, odooUrl: 'https://odoo.example.com',
      guiTin: async (t) => { tinGui.push(t); },
      guiAnhHoaDon: async () => {}, ghiLog: () => {},
    };
    return {
      goi: (cau: string) => xuLyGomDon(deps, { orgId: 'o1', conversationId: 'c1', seq: 1, cau }),
      tinGui, execute, db,
    };
  }

  it('SP giá 1đ + NV KHÔNG báo giá → hỏi giá NGAY, không tạo đơn hỏng', async () => {
    const m = mayGiaAo();
    await m.goi('lên đơn cho anh Vấn 10 cái nguồn NB 12V400W, 300 thanh led tỏa Lixin');
    expect(m.tinGui[0]).toContain('chưa có giá');
    expect(m.tinGui[0]).toContain('Led thanh tỏa');
    expect(m.execute).not.toHaveBeenCalled();
  });

  it('NV báo giá → SP giá 1đ VẪN lên đơn được, đơn ghi giá NV báo', async () => {
    const m = mayGiaAo();
    await m.goi('lên đơn cho anh Vấn 10 cái nguồn NB 12V400W x 170k, 300 thanh led tỏa Lixin 13k/thanh');
    expect(m.tinGui[0]).toContain('1.700.000đ');        // 10 × 170k, KHÔNG phải 132k
    expect(m.tinGui[0]).toContain('giá anh/chị báo');
    await m.goi('chốt');
    const payload = (m.execute.mock.calls[0][2] as Array<Record<string, unknown>>)[0];
    const lines = payload.order_line as Array<[number, number, Record<string, unknown>]>;
    expect(lines.map((l) => l[2].price_unit)).toEqual([170000, 13000]);
  });

  it('"bỏ 300 thanh led tỏa" → dòng biến mất, phần còn lại chốt được', async () => {
    const m = mayGiaAo();
    await m.goi('lên đơn cho anh Vấn 10 cái nguồn NB 12V400W, 300 thanh led tỏa Lixin');
    await m.goi('bỏ 300 thanh led tỏa');
    const cuoi = m.tinGui[m.tinGui.length - 1];
    expect(cuoi).not.toContain('Led thanh tỏa');
    expect(cuoi).toContain('Nguồn NB Ngoài Trời 12V400W');
  });

  it('phiên kẹt + "lên đơn cho anh Hoàng" → PHIÊN MỚI, không lặp lỗi cũ', async () => {
    const m = mayGiaAo();
    await m.goi('lên đơn cho anh Vấn 10 cái nguồn NB 12V400W, 300 thanh led tỏa Lixin');
    await m.goi('lên đơn cho anh Hoàng 10 cái nguồn NB 12V400W');
    const cuoi = m.tinGui[m.tinGui.length - 1];
    expect(cuoi).not.toContain('Led thanh tỏa');   // KHÔNG dính SP của phiên cũ
    expect(cuoi.toLowerCase()).toContain('bỏ đơn đang gom');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bug thật 17:41 10/08: "sửa lại đơn thêm 300 × Led thanh tỏa giá 300đ" →
// hoá đơn ghi 1đ/thanh (giá Odoo) thay vì giá NV báo. Fix giá 17:39 chỉ áp
// cho TẠO đơn, đường SỬA đơn bỏ mất donGia.
describe('sửa đơn — giá NV báo phải theo xuống tool', () => {
  it('"thêm 300 led tỏa giá 300đ" → suaDon nhận don_gia=300', async () => {
    const odoo = fakeOdoo();
    const db = fakeDb();
    const tinGui: string[] = [];
    const g: ToolAwareGenerate = async (a) => {
      const nd = String(a.messages[0].content);
      const input = nd.includes('giá 300đ')
        ? { sua: true, dong: [{ sp: 'cáp 16 sợi nhỏ', sl: 300, gia: 300 }] }
        : { ngoaiLe: true };
      return { text: '', stopReason: 'tool_use', raw: null, usage,
        toolCalls: [{ id: 't1', name: 'ghi_slot', input }] };
    };
    const deps: GomDonDeps = {
      prisma: db as never, odoo: odoo as never, generate: g,
      anhClient: null, odooUrl: 'https://odoo.example.com',
      guiTin: async (t) => { tinGui.push(t); },
      guiAnhHoaDon: async () => {}, ghiLog: () => {},
    };
    await xuLyGomDon(deps, { orgId: 'o1', conversationId: 'c1', seq: 1,
      cau: 'sửa lại đơn thêm 300 cáp 16 sợi nhỏ giá 300đ' });

    // Dòng ghi vào Odoo phải mang price_unit = 300
    const ghiDong = odoo.execute.mock.calls.filter((c) => c[0] === 'sale.order.line');
    expect(ghiDong.length).toBeGreaterThan(0);
    const payload = (ghiDong[0][2] as Array<Record<string, unknown>>)[0];
    expect(payload.price_unit).toBe(300);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// KHÁCH MỚI — bug 3 demo 17:08-17:09 10/08: NV nói "khách mới" + tên + SĐT,
// bot đáp "hệ thống chưa cho phép tạo khách mới trong lượt này".
describe('replay 10/08 — khách mới trong nhóm', () => {
  it('tra không ra khách + NV cho tên/SĐT → TẠO khách rồi chạy tiếp ngay', async () => {
    const spNho = { id: 1051, name: 'cáp 16 sợi nhỏ (cuộn)', default_code: false, list_price: 170000, uom_id: [1, 'Cuộn'] };
    const execute = vi.fn(async (model: string) => (model === 'res.partner' ? 3200 : 1));
    const searchRead = vi.fn(async (model: string, domain: unknown[]) => {
      if (model === 'res.partner') {
        // Khách mới: tra tên KHÔNG ra; đọc lại theo id (sau create) thì có.
        const theoId = (domain as unknown[]).some((d) => Array.isArray(d) && d[0] === 'id');
        return theoId ? [{ id: 3200, name: 'Chiến Tàm Xá', ref: 'KH003200' }] : [];
      }
      if (model === 'product.product') {
        const gia = (domain as unknown[]).find((d): d is [string,string,number] => Array.isArray(d) && d[0]==='list_price');
        if (gia && gia[1] === '<=') return [];
        return [{ ...spNho, active: true }];
      }
      // Bỏ bước chốt (11/08): tạo khách xong là chạy thẳng tới TẠO ĐƠN trong
      // cùng lượt, nên tool đọc lại đơn vừa tạo để xác nhận state='draft'.
      if (model === 'sale.order') {
        if (JSON.stringify(domain).includes('client_order_ref')) return [];
        return [{ id: 1, name: 'S13901', state: 'draft', amount_total: 1700000, amount_untaxed: 1700000 }];
      }
      return [];
    });
    const db = fakeDb();
    const tinGui: string[] = [];
    const g: ToolAwareGenerate = async (a) => {
      const nd = String(a.messages[0].content);
      const input = nd.includes('khách mới')
        ? { khach: 'Chiến Tàm Xá', khachMoi: { ten: 'Chiến Tàm Xá', sdt: '0969810330' },
            dong: [{ sp: 'cáp 16 sợi nhỏ', sl: 10 }] }
        : { ngoaiLe: true };
      return { text: '', stopReason: 'tool_use', raw: null, usage,
        toolCalls: [{ id: 't1', name: 'ghi_slot', input }] };
    };
    const deps: GomDonDeps = {
      prisma: db as never, odoo: { searchRead, execute } as never, generate: g,
      anhClient: null, odooUrl: 'https://odoo.example.com',
      guiTin: async (t) => { tinGui.push(t); },
      guiAnhHoaDon: async () => {}, ghiLog: () => {},
    };
    await xuLyGomDon(deps, { orgId: 'o1', conversationId: 'c1', seq: 1,
      cau: 'lên đơn cho khách mới Chiến Tàm Xá sdt 0969810330, 10 cáp 16 sợi nhỏ' });

    // ĐÃ tạo khách trên Odoo
    expect(execute.mock.calls.some((c) => c[0] === 'res.partner' && c[1] === 'create')).toBe(true);
    // và chạy TIẾP tới TẠO ĐƠN trong CHÍNH lượt này, không bắt nhắc lại.
    // (Trước 11/08 chỗ này dừng ở tóm tắt chờ chốt; giờ đi thẳng ra đơn.)
    expect(tinGui[tinGui.length - 1]).toContain('Chiến Tàm Xá');
    expect(tinGui[tinGui.length - 1]).toContain('10 × cáp 16 sợi nhỏ');
    expect(tinGui[tinGui.length - 1]).toContain('S13901');
    expect(tinGui.join('\n')).not.toContain('chưa cho phép tạo khách mới');
  });
});
