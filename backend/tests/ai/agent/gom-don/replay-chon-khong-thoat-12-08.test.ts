// SPDX-License-Identifier: AGPL-3.0-or-later
// KỊCH BẢN REPLAY — nguyên văn chat hỏng 11:52-11:58 ngày 12/08/2026
// (nhóm có anh Quyết + anh Quốc; anh Quốc: "ủa giờ lại bị lỗi gì đây???,
//  càng sửa càng lỗi à").
//
//   11:53:45  Bot: 'Có 2 khách tên "Kim LOng": 1) Led Kim Long  2) Anh Hoàng…
//                   "Led Kim LOng" có 2 loại: a) … b) … c) …
//                   Anh/chị chọn giúp em (vd: 1a) ạ.'
//   11:53:54  NV : "1"
//   11:53:54  Bot: '"Led Kim LOng" có 2 loại: a) b) c) … chọn giúp em (vd: a)'
//                                                        ← CÙNG GIÂY, in lại câu cũ
//   11:54:04  NV : "@bot 1"
//   11:54:05  Bot: '… "led thanh 1" có 2 loại: a) b) c) …'  ← ĐẺ nhóm hỏi THỨ HAI
//   11:58:09  NV : "@bot a"
//   11:58:10  Bot: '"led thanh 1" có 2 loại: …'             ← lại hỏi lại
//   11:58:15  NV : "@bot a"
//   11:58:16  Bot: 'lấy mấy cái led thanh 1m 5054 trắng (thanh),
//                   led thanh 1m 5054 trắng (thanh) ạ?'     ← MỘT SP đúp
//
// BA triệu chứng, MỘT gốc + hai hệ quả:
//   A. `apDungChon("1")` trả FALSE khi khách ĐÃ CHỐT ở lượt trước — số chỉ có
//      đường chốt khách, mà `khachUngVien` đã bị xoá nên không nhánh nào chạy.
//   B. false → orchestrator gọi LLM → model thấy "1" trơ trọi giữa phiên đang
//      hỏi "led thanh 1m…" nên trả `dong:[{sp:"1"}]`/"led thanh 1" → `dapSlot`
//      đẩy thêm MỘT dòng gom mới → nhóm hỏi thứ hai.
//   C. Hai dòng gom cùng trỏ về một SP thật → chọn "a" áp cho cả hai → đơn có
//      hai dòng y hệt nhau.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import { apDungChon } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/chon.js';
import type { PhienGom } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/kieu.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';
import { ilikeChua, khopDomain } from '../../odoo/ilike-gia.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

const kh = (id: number, ten: string) =>
  ({ id, ten, ma: `KH${String(id).padStart(6, '0')}`, dienThoai: null }) as never;
const sp = (id: number, ten: string, gia = 13000) => ({ id, ten, gia }) as never;

/** Ba loại "led thanh 1m" đúng như bot đã in lúc 11:53:45. */
const BA_LOAI = [
  sp(101, 'led thanh 1m 5054 trắng (thanh)'),
  sp(102, 'led thanh 1m 5054 trắng ấm (thanh)'),
  sp(103, 'Led 4 bóng 1m2 (bộ)'),
];

// ── Tầng 1: đơn vị — chính chỗ gãy ────────────────────────────────────────────
describe('apDungChon — câu chọn KHÔNG được rơi xuống LLM (ca thật 11:53:54 12/08)', () => {
  it('A. gõ "1" khi khách ĐÃ CHỐT ở lượt trước → vẫn NHẬN (true), không trả về LLM', () => {
    // Đúng trạng thái phiên lúc 11:53:54: lượt trước "1" đã chốt khách, danh
    // sách SP vẫn treo. Trả false ở đây là mở đường cho model bịa tên SP "1".
    const p: PhienGom = {
      khachTuKhoa: 'Kim LOng',
      khachDaChot: kh(1, 'Led Kim Long'),
      dong: [{ tuKhoa: 'led thanh 1m', sl: null, ungVien: [...BA_LOAI] as never }],
    };
    expect(apDungChon(p, '1')).toBe(true);
    // Số là để chọn KHÁCH — không được biến thành lựa chọn SP bừa.
    expect(p.dong[0].daChot).toBeUndefined();
    expect(p.dong[0].ungVien).toHaveLength(3);
  });

  it('A2. gõ "1" khi KHÔNG còn gì đang chờ chọn → trả false như cũ (nhường LLM)', () => {
    // Hàng rào phải HẸP: chỉ nuốt số khi thật sự có danh sách treo. Phiên không
    // chờ chọn gì mà nuốt "1" là chặn mất câu nói thường ("1 cái nữa em").
    const p: PhienGom = {
      khachTuKhoa: 'Kim LOng',
      khachDaChot: kh(1, 'Led Kim Long'),
      dong: [{ tuKhoa: 'led thanh 1m', sl: null, daChot: sp(101, 'led thanh 1m 5054 trắng (thanh)') }],
    };
    expect(apDungChon(p, '1')).toBe(false);
  });

  it('C. hai nhóm hỏi CHỒNG NHAU + chọn "a" → chỉ MỘT dòng hàng, không đúp', () => {
    // Trạng thái lúc 11:58:15 sau khi bug B đã đẻ ra nhóm thứ hai. Kể cả khi
    // phiên đã lỡ có hai dòng chồng nhau, chọn "a" không được ra hai dòng cùng
    // product_id — đó là đơn sai tiền thật của khách.
    const p: PhienGom = {
      khachTuKhoa: 'Kim LOng',
      khachDaChot: kh(1, 'Led Kim Long'),
      dong: [
        { tuKhoa: 'led thanh 1m', sl: 10, ungVien: [...BA_LOAI] as never },
        { tuKhoa: 'led thanh 1', sl: null, ungVien: [...BA_LOAI] as never },
      ],
    };
    expect(apDungChon(p, 'a')).toBe(true);
    const daChot = p.dong.filter((d) => d.daChot);
    expect(daChot).toHaveLength(1);
    expect(daChot[0].daChot!.ten).toBe('led thanh 1m 5054 trắng (thanh)');
    // SL của dòng gốc phải còn nguyên — gộp chứ không xoá mất số lượng đã có.
    expect(daChot[0].sl).toBe(10);
  });

  it('ca cũ vẫn chạy: "1a" chốt CẢ khách lẫn SP', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Kim LOng',
      khachUngVien: [kh(1, 'Led Kim Long'), kh(2, 'Anh Hoàng - CTCP Kim Khí Thăng Long')] as never,
      dong: [{ tuKhoa: 'led thanh 1m', sl: null, ungVien: [...BA_LOAI] as never }],
    };
    expect(apDungChon(p, '1a')).toBe(true);
    expect(p.khachDaChot!.ten).toBe('Led Kim Long');
    expect(p.dong[0].daChot!.ten).toBe('led thanh 1m 5054 trắng (thanh)');
  });

  it('ca cũ vẫn chạy: "a, b" chọn NHIỀU nhóm cùng lúc', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Kim LOng',
      khachDaChot: kh(1, 'Led Kim Long'),
      dong: [
        { tuKhoa: 'led thanh 1m', sl: 10, ungVien: [...BA_LOAI] as never },
        { tuKhoa: 'nguồn 12v', sl: 5, ungVien: [sp(201, 'Nguồn 12V 5A'), sp(202, 'Nguồn 12V 10A')] as never },
      ],
    };
    expect(apDungChon(p, 'a, b')).toBe(true);
    expect(p.dong[0].daChot!.ten).toBe('led thanh 1m 5054 trắng (thanh)');
    expect(p.dong[1].daChot!.ten).toBe('Nguồn 12V 10A');
  });

  it('KHÔNG nuốt tên khách toàn chữ cái ("Anh Long Led" — ca 16:16 11/08)', () => {
    // Hàng rào nuốt câu chọn đọc theo TỪNG TỪ. Nếu gộp cả câu rồi bóc chữ thì
    // "Anh Long Led" ra "anhlonged" — toàn chữ cái — và bị nuốt như câu chọn,
    // dựng lại đúng bug tên khách nằm ngoài trang đầu.
    const p: PhienGom = {
      khachTuKhoa: 'Long',
      khachUngVien: [kh(1, 'Anh Long - Hà Đông'), kh(2, 'Anh Long Biên')] as never,
      dong: [],
    };
    expect(apDungChon(p, 'Anh Long Led')).toBe(false);
    expect(p.khachDaChot).toBeUndefined();
  });

  it('KHÔNG nuốt số khi phiên không chờ chọn gì — "10" vẫn về LLM', () => {
    // Câu chỉ có số giữa phiên đã chốt hết là SỐ LƯỢNG, không phải câu chọn.
    const p: PhienGom = {
      khachTuKhoa: 'Kim LOng',
      khachDaChot: kh(1, 'Led Kim Long'),
      dong: [{ tuKhoa: 'led thanh 1m', sl: null, daChot: sp(101, 'led thanh 1m 5054 trắng (thanh)') }],
    };
    expect(apDungChon(p, '10')).toBe(false);
  });

  it('cổng LA_KHACH_MOI vẫn thông (bug 10/08) — "khách mới" đi qua được', () => {
    const p: PhienGom = {
      khachTuKhoa: 'Chiến',
      khachUngVien: [kh(1, 'Anh Chiến'), kh(2, 'Anh Chiến Hà Đông')] as never,
      dong: [],
    };
    expect(apDungChon(p, 'khách mới')).toBe(false);
    expect(p.khachDaChot).toBeUndefined();
  });
});

// ── Tầng 2: replay end-to-end đúng thứ tự tin thật ────────────────────────────

/**
 * LLM giả — mô phỏng ĐÚNG lỗi thật: gặp câu chọn trơ trọi ("1", "a") giữa phiên
 * đang hỏi SP thì bịa ra dòng hàng mang chính chữ đó. Đây là hành vi model đo
 * được trên prod, không phải phỏng đoán: nó thấy phiên đang nói về "led thanh
 * 1m…" nên ghép "1" thành "led thanh 1".
 *
 * Bản vá phải làm cho LLM này KHÔNG BAO GIỜ được hỏi ở các lượt chọn.
 */
function fakeGenerate(): ToolAwareGenerate {
  return async (a) => {
    const nd = String(a.messages[0].content);
    const input = nd.includes('lên đơn cho led kim lonng')
      ? { lenDon: true, khach: 'kim lonng', dong: [{ sp: 'led thanh 1m', sl: 10 }] }
      : nd.includes('Kim LOng')
        ? { lenDon: true, khach: 'Kim LOng', dong: [{ sp: 'led thanh 1m', sl: 10 }] }
        // ← ĐÂY là chỗ bịa: câu chọn trơ trọi thành TÊN SẢN PHẨM.
        : { dong: [{ sp: `led thanh ${nd.replace(/[^a-z0-9]/gi, '')}` }] };
    return {
      text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't1', name: 'ghi_slot', input }],
    };
  };
}

function fakeOdoo() {
  const partners = [
    { id: 1, name: 'Led Kim Long', ref: 'KH000101', phone: '0911000111' },
    { id: 2, name: 'Anh Hoàng - CTCP Kim Khí Thăng Long', ref: 'KH002722AC', phone: '0977668973' },
  ].map((p) => ({ ...p, mobile: false, incokit_receivable_balance: 0 }));

  const products = [
    { id: 101, name: 'led thanh 1m 5054 trắng (thanh)', default_code: false, list_price: 13000, uom_id: [1, 'Thanh'] },
    { id: 102, name: 'led thanh 1m 5054 trắng ấm (thanh)', default_code: false, list_price: 13000, uom_id: [1, 'Thanh'] },
    { id: 103, name: 'Led 4 bóng 1m2 (bộ)', default_code: false, list_price: 45000, uom_id: [1, 'Bộ'] },
  ];

  const searchRead = vi.fn(async (model: string, domain: unknown[], _f: unknown, opts?: { limit?: number }) => {
    if (model === 'res.partner') {
      const dkId = (domain as unknown[][]).find(
        (d) => Array.isArray(d) && d[0] === 'id' && (d[1] === '=' || d[1] === 'in'));
      if (dkId) {
        const ids = Array.isArray(dkId[2]) ? (dkId[2] as number[]) : [Number(dkId[2])];
        return partners.filter((p) => ids.includes(p.id));
      }
      const coDkTen = (domain as unknown[]).some(
        (d) => Array.isArray(d) && d[0] === 'name' && d[1] === 'ilike');
      const khop = coDkTen
        ? partners.filter((p) => khopDomain(domain as unknown[], (dk) =>
            dk[0] === 'name' && dk[1] === 'ilike' ? ilikeChua(String(dk[2]), p.name) : true))
        : partners;
      return khop.slice(0, opts?.limit ?? khop.length);
    }
    if (model === 'product.product') {
      const coDkTen = (domain as unknown[]).some(
        (d) => Array.isArray(d) && d[0] === 'name' && d[1] === 'ilike');
      const khop = coDkTen
        ? products.filter((p) => khopDomain(domain as unknown[], (dk) =>
            dk[0] === 'name' && dk[1] === 'ilike' ? ilikeChua(String(dk[2]), p.name) : true))
        : products;
      const dkGia = (domain as unknown[][]).find(
        (d) => Array.isArray(d) && d[0] === 'list_price');
      if (dkGia?.[1] === '>') return khop.filter((p) => p.list_price > Number(dkGia[2]));
      if (dkGia?.[1] === '<=') return khop.filter((p) => p.list_price <= Number(dkGia[2]));
      return khop;
    }
    if (model === 'sale.order') {
      if (JSON.stringify(domain).includes('client_order_ref')) return [];
      return [{ id: 900, name: 'S13850', state: 'draft', amount_total: 130000, amount_untaxed: 130000 }];
    }
    return [];
  });
  const execute = vi.fn(async () => 900);
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
  let seq = 0;
  const goi = (cau: string) =>
    xuLyGomDon(deps, { orgId: 'o1', conversationId: 'c1', seq: ++seq, cau });
  return { goi, tinGui, odoo };
}

describe('replay 11:52-11:58 12/08 — nhân viên chọn mà bot không thoát vòng hỏi', () => {
  it('lượt 1: bot hỏi chọn CẢ khách lẫn SP (vd: 1a)', async () => {
    const m = dungMay();
    expect(await m.goi('lên đơn cho Kim LOng 10 led thanh 1m')).toBe(true);
    expect(m.tinGui).toHaveLength(1);
    expect(m.tinGui[0]).toContain('2 khách tên');
    expect(m.tinGui[0]).toContain('2 loại');
    expect(m.tinGui[0]).toContain('vd: 1a');
  });

  it('A. gõ "1" → chốt khách, KHÔNG in lại nguyên câu hỏi cũ', async () => {
    const m = dungMay();
    await m.goi('lên đơn cho Kim LOng 10 led thanh 1m');
    expect(await m.goi('1')).toBe(true);

    expect(m.tinGui).toHaveLength(2);
    // Không lặp nguyên văn tin trước.
    expect(m.tinGui[1]).not.toBe(m.tinGui[0]);
    // Khách đã chốt → tin sau KHÔNG còn hỏi khách nữa.
    expect(m.tinGui[1]).not.toContain('2 khách tên');
    // Vẫn còn phải chọn SP — đúng, nhưng chỉ nhóm SP GỐC.
    expect(m.tinGui[1]).toContain('vd: a');
  });

  it('B. gõ "1" → KHÔNG đẻ nhóm hỏi mới cho sản phẩm', async () => {
    const m = dungMay();
    await m.goi('lên đơn cho Kim LOng 10 led thanh 1m');
    await m.goi('1');
    // Lượt thứ hai gõ "1" nữa (11:54:04 "@bot 1") — vẫn không được đẻ nhóm mới.
    await m.goi('1');

    const cuoi = m.tinGui[m.tinGui.length - 1];
    // Bug thật 11:54:05: đẻ ra nhóm hỏi thứ hai '"led thanh 1" có N loại'.
    expect(cuoi).not.toContain('"led thanh 1" có');
    // Không lượt nào được sinh thêm nhóm hỏi SP thứ hai.
    for (const t of m.tinGui) {
      expect((t.match(/có \d+ loại/g) ?? []).length).toBeLessThanOrEqual(1);
    }
    // Guard chống lặp đổi lời — nhưng đường thoát phải chỉ đúng việc ĐANG treo
    // (chọn CHỮ CÁI của hàng), không lôi nhân viên về phần khách đã xong.
    expect(cuoi).not.toContain('mã KH của khách');
    expect(cuoi).toMatch(/CHỮ CÁI|tên hàng/);
  });

  it('C. chọn "a" sau chuỗi trên → CHỈ MỘT dòng hàng, không đúp', async () => {
    const m = dungMay();
    await m.goi('lên đơn cho Kim LOng 10 led thanh 1m');
    await m.goi('1');
    await m.goi('1');
    await m.goi('a');

    const cuoi = m.tinGui[m.tinGui.length - 1];
    // Bug thật 11:58:16: 'lấy mấy cái led thanh 1m 5054 trắng (thanh),
    // led thanh 1m 5054 trắng (thanh) ạ?' — tên lặp HAI lần trong một câu.
    const soLan = cuoi.split('led thanh 1m 5054 trắng (thanh)').length - 1;
    expect(soLan).toBeLessThanOrEqual(1);
  });

  it('chuỗi ĐÚNG "1a" đi thẳng: chốt khách + SP trong một lượt', async () => {
    const m = dungMay();
    await m.goi('lên đơn cho Kim LOng 10 led thanh 1m');
    expect(await m.goi('1a')).toBe(true);

    const cuoi = m.tinGui[m.tinGui.length - 1];
    // Đủ khách + SP + SL → lên đơn thẳng, không hỏi chọn nữa.
    expect(cuoi).not.toContain('chọn giúp em');
    expect(cuoi).toContain('Led Kim Long');
  });
});
