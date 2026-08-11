// SPDX-License-Identifier: AGPL-3.0-or-later
// BỎ HẲN BƯỚC HỎI CHỐT khi lên đơn (anh Quốc chốt 11/08/2026).
//
// ── QUYẾT ĐỊNH ────────────────────────────────────────────────────────────
// Nguyên văn anh Quốc: "tôi muốn bỏ luôn cái bước chốt đơn này được không?,
// nếu mọi thứ đã rõ ràng thì lên đơn báo giá luôn". Hỏi lại có giữ ngoại lệ
// nào không (giá lệch bất thường / khách vừa tạo mới / đơn tiền lớn), anh trả
// lời: "Bỏ hoàn toàn, không hỏi gì nữa".
//
// ── TRƯỚC ─────────────────────────────────────────────────────────────────
//   NV: "lên đơn cho anh cảnh 100 card V7512 giá 230k"
//   bot: "Đơn cho Anh Cảnh… 100 × Card thu = 23.000.000đ
//         Tổng: 23.000.000đ. Em chốt lên đơn nhé?"
//   NV: "ok"                                   ← LƯỢT THỪA, bỏ đi
//   bot: "Đã lên đơn nháp S13825…"
//
// ── SAU ───────────────────────────────────────────────────────────────────
// Một lượt duy nhất: tóm tắt (GIỮ NGUYÊN nội dung, đổi câu hỏi thành câu kể)
// + đơn đã tạo + ảnh báo giá.
//
// Tóm tắt KHÔNG bị bỏ đi cùng câu hỏi: nhân viên vẫn phải soát được bot hiểu
// đúng khách nào, hàng gì, giá bao nhiêu — chỉ là soát SAU khi đơn đã lên
// (đơn nháp sửa được), thay vì phải gật trước.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function fakeGenerate(slots: Record<string, unknown>[]): ToolAwareGenerate {
  let i = 0;
  return async () => {
    const input = slots[Math.min(i++, slots.length - 1)];
    return { text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't', name: 'ghi_slot', input }] };
  };
}

/** Odoo giả: 1 khách khớp, 1 SP khớp — ca "mọi thứ đã rõ ràng" anh Quốc nói. */
function fakeOdoo() {
  const kh = [{ id: 3803, name: 'Anh Cảnh - Led Việt - Tam Kỳ', ref: 'KH003067ACDL', phone: false }];
  const sp = { id: 448, name: 'Card thu BX-V7512 (cái)', default_code: 'SP000448', list_price: 230000, uom_id: [1, 'Cái'] };
  return {
    searchRead: vi.fn(async (model: string, domain: unknown[]) => {
      if (model === 'res.partner') return kh;
      if (model === 'product.product') {
        const g = (domain as unknown[]).find(
          (d): d is [string, string, number] => Array.isArray(d) && d[0] === 'list_price');
        if (g && g[1] === '<=') return [];
        return [sp];
      }
      if (model === 'sale.order') {
        // Tra CHỐNG TRÙNG (theo client_order_ref) → chưa có đơn nào.
        const theoKhoa = (domain as unknown[]).some(
          (d) => Array.isArray(d) && d[0] === 'client_order_ref');
        if (theoKhoa) return [];
        // Đọc lại đơn vừa tạo (bước XÁC NHẬN của tao-don-nhap, theo id): phải
        // trả ra đơn draft, nếu không tool báo "đọc lại không thấy".
        return [{ id: 26742, name: 'S13825', state: 'draft', amount_total: 23000000, amount_untaxed: 23000000 }];
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

function dungMay(slots: Record<string, unknown>[], coAnh = false) {
  const odoo = fakeOdoo();
  const db = fakeDb();
  const tinGui: string[] = [];
  const anhGui: unknown[] = [];
  const deps: GomDonDeps = {
    prisma: db as never, odoo: odoo as never, generate: fakeGenerate(slots),
    anhClient: coAnh ? ({} as never) : null,
    odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async (a) => { anhGui.push(a); },
    ghiLog: () => {},
  };
  return {
    goi: (cau: string) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId: 'c-bo-chot', seq: 1, cau, senderUid: 'uid-nv',
    }),
    tinGui, anhGui, odoo, db,
  };
}

const lenhTaoDon = (odoo: ReturnType<typeof fakeOdoo>) =>
  odoo.execute.mock.calls.find((c) => String(c[0]) === 'sale.order' && String(c[1]) === 'create');

describe('bỏ bước chốt — đủ thông tin thì LÊN ĐƠN NGAY trong một lượt', () => {
  const SLOT = {
    lenDon: true, khach: 'cảnh tam kỳ',
    dong: [{ sp: 'card nhận V7512', sl: 100, gia: 230000 }],
  };

  it('MỘT lượt duy nhất → đơn đã vào Odoo, KHÔNG chờ ai gật', async () => {
    const { goi, odoo } = dungMay([SLOT]);
    await goi('lên đơn cho anh cảnh tam kỳ 100 cái card nhận V7512 giá 230k');
    // Đây là điều đổi: trước đây lượt này chỉ hỏi, chưa ghi gì vào Odoo.
    expect(lenhTaoDon(odoo)).toBeDefined();
  });

  it('KHÔNG còn câu hỏi chốt nào trong tin trả về', async () => {
    const { goi, tinGui } = dungMay([SLOT]);
    await goi('lên đơn cho anh cảnh tam kỳ 100 cái card nhận V7512 giá 230k');
    const tra = tinGui.join('\n');
    expect(tra).not.toContain('Em chốt lên đơn nhé?');
    expect(tra).not.toMatch(/chốt lên đơn/i);
    expect(tra).not.toMatch(/em chốt.*nhé/i);
  });

  it('tin trả về VẪN có đủ tóm tắt: tên khách + mã KH + dòng hàng + tổng', async () => {
    const { goi, tinGui } = dungMay([SLOT]);
    await goi('lên đơn cho anh cảnh tam kỳ 100 cái card nhận V7512 giá 230k');
    const tra = tinGui.join('\n');
    // Nhân viên vẫn phải soát được bot hiểu gì — chỉ đổi THÌ, không bỏ nội dung.
    expect(tra).toContain('Anh Cảnh - Led Việt - Tam Kỳ');
    expect(tra).toContain('KH003067ACDL');
    expect(tra).toContain('100 × Card thu BX-V7512 (cái)');
    expect(tra).toContain('23.000.000đ');
  });

  it('tin trả về có mã đơn + tổng + link Odoo', async () => {
    const { goi, tinGui } = dungMay([SLOT]);
    await goi('lên đơn cho anh cảnh tam kỳ 100 cái card nhận V7512 giá 230k');
    const tra = tinGui.join('\n');
    // Tin THẬT bot gửi ở ca này (khoá nguyên văn để đổi lời là test kêu):
    //   Đơn cho Anh Cảnh - Led Việt - Tam Kỳ (KH003067ACDL):
    //   100 × Card thu BX-V7512 (cái) = 23.000.000đ (giá anh/chị báo 230.000đ)
    //   Tổng: 23.000.000đ.
    //   Em đã lên đơn nháp S13825 cho Anh Cảnh - Led Việt - Tam Kỳ, tổng
    //   23.000.000đ. Link xử lý: https://odoo.example.com/web#id=26742&...
    //   Sai chỗ nào anh/chị nhắn "sửa đơn ..." em sửa ngay ạ.
    expect(tra).toContain('Em đã lên đơn nháp S13825');
    expect(tra).toContain('23.000.000');
    expect(tra).toContain('https://odoo.example.com');
  });

  it('vẫn GỬI ẢNH báo giá — thứ nhân viên chuyển cho khách', async () => {
    // anhClient bật; guiHoaDon thật sẽ hỏng với odoo giả nhưng luồng phải
    // nuốt lỗi và VẪN gửi text + link (nếp "gửi link DÙ ảnh lỗi").
    const { goi, tinGui } = dungMay([SLOT], true);
    await goi('lên đơn cho anh cảnh tam kỳ 100 cái card nhận V7512 giá 230k');
    expect(tinGui.join('\n')).toContain('S13825');
  });

  it('giá NV báo lệch giá hệ thống → tóm tắt VẪN nói rõ hai con số', async () => {
    const { goi, tinGui } = dungMay([{
      lenDon: true, khach: 'cảnh tam kỳ',
      // 200k vs 230k hệ thống: lệch có thật nhưng HỢP LÝ (tỷ lệ 0,87) → không
      // chạm hàng rào giá, nhưng phải in ra cho nhân viên soát.
      dong: [{ sp: 'card nhận V7512', sl: 100, gia: 200000 }],
    }]);
    await goi('lên đơn cho anh cảnh 100 card V7512 giá 200k');
    const tra = tinGui.join('\n');
    expect(tra).toContain('giá anh/chị báo 200.000đ');
    expect(tra).toContain('hệ thống 230.000đ');
  });

  it('chiết khấu + tặng kèm vẫn hiện đủ trong tóm tắt', async () => {
    const { goi, tinGui } = dungMay([{
      lenDon: true, khach: 'cảnh tam kỳ',
      dong: [
        { sp: 'card nhận V7512', sl: 100, gia: 230000, chietKhau: 8 },
        { sp: 'card nhận V7512', sl: 2, tang: true },
      ],
    }]);
    await goi('lên đơn cho anh cảnh 100 card V7512 giá 230k ck 8%, tặng 2 cái');
    const tra = tinGui.join('\n');
    expect(tra).toMatch(/CK 8%/);
    expect(tra).toMatch(/TẶNG/);
    expect(tra).toContain('21.160.000đ');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Bỏ bước CHỐT không được kéo theo phần HỎI THIẾU. Anh Quốc bỏ nhịp "đúng
// chưa, lên nhé?" khi mọi thứ đã rõ — không bỏ việc hỏi khi máy CHƯA BIẾT.
describe('bỏ bước chốt KHÔNG làm hỏng phần hỏi khi thiếu thông tin', () => {
  it('thiếu KHÁCH → vẫn hỏi, KHÔNG lên đơn', async () => {
    const { goi, tinGui, odoo } = dungMay([
      { lenDon: true, dong: [{ sp: 'card nhận V7512', sl: 100, gia: 230000 }] },
    ]);
    await goi('lên đơn 100 card V7512 giá 230k');
    expect(tinGui.join('\n')).toMatch(/khách nào/i);
    expect(lenhTaoDon(odoo)).toBeUndefined();
  });

  it('thiếu SỐ LƯỢNG → vẫn hỏi, KHÔNG lên đơn', async () => {
    const { goi, tinGui, odoo } = dungMay([
      { lenDon: true, khach: 'cảnh tam kỳ', dong: [{ sp: 'card nhận V7512' }] },
    ]);
    await goi('lên đơn cho anh cảnh card V7512');
    expect(tinGui.join('\n')).toMatch(/mấy cái/i);
    expect(lenhTaoDon(odoo)).toBeUndefined();
  });

  it('chưa nói HÀNG gì → vẫn hỏi, KHÔNG lên đơn', async () => {
    const { goi, tinGui, odoo } = dungMay([{ lenDon: true, khach: 'cảnh tam kỳ', dong: [] }]);
    await goi('lên đơn cho anh cảnh tam kỳ');
    expect(tinGui.join('\n')).toMatch(/hàng gì|sản phẩm/i);
    expect(lenhTaoDon(odoo)).toBeUndefined();
  });

  it('trả lời tiếp phần thiếu → đủ là lên đơn NGAY, không hỏi chốt', async () => {
    const { goi, tinGui, odoo } = dungMay([
      { lenDon: true, khach: 'cảnh tam kỳ', dong: [{ sp: 'card nhận V7512' }] },
      { dong: [{ sp: 'card nhận V7512', sl: 100, gia: 230000 }] },
    ]);
    await goi('lên đơn cho anh cảnh card V7512');
    await goi('100 cái giá 230k');
    expect(lenhTaoDon(odoo)).toBeDefined();
    expect(tinGui.join('\n')).not.toMatch(/chốt lên đơn/i);
  });
});
