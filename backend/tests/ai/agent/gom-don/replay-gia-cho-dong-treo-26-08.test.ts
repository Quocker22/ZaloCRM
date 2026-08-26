// SPDX-License-Identifier: AGPL-3.0-or-later
// REPLAY ca thật 08:52–08:56 26/08 (Anh Tài Nam Định, đơn S15264, chế SỬA):
//
//   08:52:47 NV : "@bot không đúng. Lấy thanh toả 1m màu trắng mà"
//   08:52:53 Bot: "thanh toả 1m màu trắng" có 2 loại: a) … b) Led thanh toả 1m
//                 ngoài trời Lixin màu Trắng (thanh) · chưa có giá
//   08:53:00 NV : "B"            → Bot: "Anh/chị lấy mấy cái … ạ?"
//   08:53:05 NV : "160"          → Bot: 'Sản phẩm "Led thanh toả 1m ngoài trời
//                 Lixin màu Trắng (thanh)" chưa có giá… báo giá giúp em (vd: 13k/thanh)'
//   08:53:16 NV : "Giá 13k"      → Bot: 'Em vẫn chưa khớp được "Giá 13k" với
//                 dòng nào trên đơn nào ạ…'                       ← BUG
//   08:55:53 NV : "led thanh toả trắng 12v lixin giá 13k" → lại "chưa có giá"  ← BUG
//
// Anh Quốc: '"Led thanh toả 1m ngoài trời Lixin màu Trắng" nhắc đi nhắc lại hoài'.
// Gốc: regex đường tắt sửa giá CƯỚP LƯỢT model (daHoiLlm) dù khối áp giá của
// nó chỉ chạy khi phien.dong rỗng → giá không tới model, cũng không tới dòng.
//
// NẾP: LLM hiểu câu chữ (đọc "Bot vừa hỏi" mà gắn giá vào đúng SP), CODE giữ
// luật (câu chỉ có giá + một dòng chờ giá → gắn vào dòng đó, không mở dòng mới).
// Chuỗi câu dưới đây là DỮ LIỆU KỊCH BẢN; LLM giả trả slot như một model đọc
// đúng prompt sẽ trả. Điều được kiểm: prompt có ngữ cảnh, trạng thái phiên,
// tin bot gửi, Odoo nhận gì.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';
import { ilikeChua } from '../../odoo/ilike-gia.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const TEN_SP = 'Led thanh toả 1m ngoài trời Lixin màu Trắng';

function fakeGenerate(): { g: ToolAwareGenerate; prompts: () => string[] } {
  const prompts: string[] = [];
  const g: ToolAwareGenerate = async (a) => {
    const nd = String(a.messages[0].content);
    prompts.push(`${String(a.system ?? '')}\n${nd}`);
    const cauNv = (nd.match(/Câu nhân viên: "([^"]*)"/)?.[1] ?? nd).toLowerCase();
    let input: Record<string, unknown>;
    if (cauNv.includes('thanh toả 1m màu trắng')) {
      input = { sua: true, dong: [{ sp: 'thanh toả 1m màu trắng' }] };
    } else if (/^\s*160\s*$/.test(cauNv)) {
      input = { dong: [{ sp: 'thanh toả 1m màu trắng', sl: 160 }] };
    } else if (/13k|13\.000/.test(cauNv) && nd.includes('chưa có giá')) {
      // Model đọc "Bot vừa hỏi: … chưa có giá" → gắn giá cho đúng SP bot hỏi
      // (theo lời dặn TRẢ LỜI GIÁ). Biến thể NV gọi tên theo cách của họ →
      // model có thể trả sp theo chữ NV — code phải chịu được cả hai.
      input = cauNv.includes('lixin')
        ? { dong: [{ sp: 'led thanh toả trắng 12v lixin', gia: 13000 }] }
        : { dong: [{ sp: TEN_SP, gia: 13000 }] };
    } else {
      input = { ngoaiLe: true };
    }
    return { text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't1', name: 'ghi_slot', input }] };
  };
  return { g, prompts: () => prompts };
}

const SP_TRONG_NHA = { id: 551, name: 'Led thanh toả 1m Lixin trong nhà màu Trắng - (Công Trình) (thanh)', default_code: false, list_price: 1, uom_id: [1, 'Thanh'] };
const SP_NGOAI_TROI = { id: 552, name: `${TEN_SP} (thanh)`, default_code: false, list_price: 1, uom_id: [1, 'Thanh'] };

function fakeOdoo() {
  const donNhap = [{ id: 28182, name: 'S15264', amount_total: 5_210_000, state: 'draft' }];
  const products = [SP_TRONG_NHA, SP_NGOAI_TROI];
  const layDk = (domain: unknown[], f: string, op: string) =>
    (domain.find((d) => Array.isArray(d) && d[0] === f && d[1] === op) as unknown[] | undefined)?.[2];
  const searchRead = vi.fn(async (model: string, domain: unknown[]) => {
    if (model === 'product.product') {
      const ids = layDk(domain, 'id', 'in') as number[] | undefined;
      if (ids) return products.filter((p) => ids.includes(p.id));
      const tuKhoa = (domain as unknown[])
        .filter((d): d is [string, string, string] =>
          Array.isArray(d) && d[0] === 'name' && d[1] === 'ilike' && typeof d[2] === 'string')
        .map((d) => d[2]);
      if (tuKhoa.length === 0) return products;
      const laOr = !(domain as unknown[]).includes('&');
      return products.filter((p) => (laOr
        ? tuKhoa.some((t) => ilikeChua(t, p.name))
        : tuKhoa.every((t) => ilikeChua(t, p.name))));
    }
    if (model === 'sale.order') {
      const id = layDk(domain, 'id', '=');
      if (id != null) return donNhap.filter((d) => d.id === Number(id)).map((d) => ({ ...d, create_date: '2026-08-26 01:47:00' }));
      const ma = layDk(domain, 'name', '=');
      if (ma != null) return donNhap.filter((d) => d.name === ma).map((d) => ({ ...d, create_date: '2026-08-26 01:47:00' }));
      return donNhap.map((d) => ({ ...d, create_date: '2026-08-26 01:47:00' }));
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
      deleteMany: async ({ where }: { where: { conversationId: string } }) => { rows.delete(where.conversationId); return { count: 1 }; },
    },
  };
}

type Phien = { dong: Array<{ sl: number | null; donGia?: number; daChot?: { id: number } }> };

function dungMay() {
  const odoo = fakeOdoo();
  const db = fakeDb();
  const { g, prompts } = fakeGenerate();
  const tinGui: string[] = [];
  const log: Array<{ toolName: string }> = [];
  const deps: GomDonDeps = {
    prisma: db as never, odoo: odoo as never, generate: g, anhClient: null,
    odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {},
    ghiLog: (l) => log.push({ toolName: l.toolName }),
  };
  let seq = 0;
  const goi = (cau: string) => xuLyGomDon(deps, { orgId: 'o1', conversationId: 'c1', seq: ++seq, cau });
  const phien = () => db.rows.get('c1')?.slots as Phien;
  const dongGhi = () => odoo.execute.mock.calls.filter((c) => c[0] === 'sale.order.line' && c[1] === 'create');
  return { goi, tinGui, odoo, log, prompts, phien, dongGhi };
}

/** Đi tới đúng chỗ bot hỏi giá — như 08:53:08 ca thật. */
async function toiLucHoiGia(m: ReturnType<typeof dungMay>): Promise<void> {
  await m.goi('sửa đơn thanh toả 1m màu trắng');
  expect(m.tinGui.at(-1)).toContain(`b) ${TEN_SP}`);
  await m.goi('B');
  expect(m.tinGui.at(-1)).toMatch(/mấy cái/);
  await m.goi('160');
  // "160" là SỐ LƯỢNG — phải nằm ở sl, KHÔNG được thành giá 160đ.
  expect(m.phien().dong[0]).toMatchObject({ sl: 160, daChot: { id: 552 } });
  expect(m.phien().dong[0].donGia).toBeUndefined();
  expect(m.tinGui.at(-1)).toContain('chưa có giá');
  expect(m.odoo.execute).not.toHaveBeenCalled();
}

describe('replay 26/08 — trả lời câu hỏi giá phải vào đúng dòng đang chờ', () => {
  it('model ĐƯỢC hỏi và prompt có ngữ cảnh "Bot vừa hỏi … chưa có giá" + tên SP', async () => {
    const m = dungMay();
    await toiLucHoiGia(m);
    const truoc = m.prompts().length;
    await m.goi('Giá 13k');
    const p = m.prompts();
    expect(p.length).toBe(truoc + 1); // regex KHÔNG được cướp lượt model
    expect(p.at(-1)).toContain('chưa có giá');
    expect(p.at(-1)).toContain(TEN_SP);
    expect(p.at(-1)).toContain('TRẢ LỜI GIÁ');
  });

  it('"Giá 13k" → dòng 160 × 13.000đ ghi Odoo, không hỏi lại', async () => {
    const m = dungMay();
    await toiLucHoiGia(m);
    await m.goi('Giá 13k');
    expect(m.tinGui.at(-1)).not.toMatch(/chưa khớp được|chưa có giá/);
    expect(m.dongGhi()).toHaveLength(1);
    expect((m.dongGhi()[0][2] as unknown[])[0]).toMatchObject({ product_id: 552, product_uom_qty: 160, price_unit: 13000 });
    expect(m.log.map((l) => l.toolName)).toContain('sua_don');
  });

  it('NV gọi tên theo cách của họ ("led thanh toả trắng 12v lixin giá 13k") → code gắn vào dòng chờ duy nhất, KHÔNG mở dòng mới', async () => {
    const m = dungMay();
    await toiLucHoiGia(m);
    await m.goi('led thanh toả trắng 12v lixin giá 13k');
    expect(m.tinGui.at(-1)).not.toMatch(/chưa khớp được|chưa có giá|có \d+ loại/);
    expect(m.dongGhi()).toHaveLength(1);
    expect((m.dongGhi()[0][2] as unknown[])[0]).toMatchObject({ product_id: 552, price_unit: 13000 });
  });
});
