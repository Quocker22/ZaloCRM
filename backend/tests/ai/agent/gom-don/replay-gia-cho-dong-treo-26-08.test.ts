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
// Gốc: đường tắt sửa giá chỉ áp khi phien.dong rỗng; dòng chờ giá nằm trong
// phien.dong nên giá không bao giờ tới.
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';
import { ilikeChua } from '../../odoo/ilike-gia.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function fakeGenerate(): { g: ToolAwareGenerate; soLanGoi: () => number } {
  let n = 0;
  const g: ToolAwareGenerate = async (a) => {
    n++;
    const nd = String(a.messages[0].content);
    const input = nd.includes('thanh toả 1m màu trắng')
      ? { sua: true, dong: [{ sp: 'thanh toả 1m màu trắng' }] }
      : /\b160\b/.test(nd)
        ? { dong: [{ sp: 'thanh toả 1m màu trắng', sl: 160 }] }
        : { ngoaiLe: true };
    return { text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't1', name: 'ghi_slot', input }] };
  };
  return { g, soLanGoi: () => n };
}

const SP_TRONG_NHA = { id: 551, name: 'Led thanh toả 1m Lixin trong nhà màu Trắng - (Công Trình) (thanh)', default_code: false, list_price: 1, uom_id: [1, 'Thanh'] };
const SP_NGOAI_TROI = { id: 552, name: 'Led thanh toả 1m ngoài trời Lixin màu Trắng (thanh)', default_code: false, list_price: 1, uom_id: [1, 'Thanh'] };

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

function dungMay() {
  const odoo = fakeOdoo();
  const db = fakeDb();
  const { g, soLanGoi } = fakeGenerate();
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
  return { goi, tinGui, odoo, db, log, soLanGoi };
}

async function toiLucHoiGia(m: ReturnType<typeof dungMay>): Promise<void> {
  // Ca thật đã có phiên SỬA từ câu 18:48 "Sửa đơn…"; ở đây mở phiên bằng chính
  // lệnh sửa (regex bắt "sửa đơn"), rồi chọn b) như NV. Chuỗi câu là DỮ LIỆU
  // ĐẦU VÀO của kịch bản; điều được kiểm là TRẠNG THÁI PHIÊN + tin bot gửi +
  // Odoo nhận gì — không phải giá trị trả về của xuLyGomDon.
  await m.goi('sửa đơn thanh toả 1m màu trắng');
  expect(m.tinGui.at(-1)).toContain('b) Led thanh toả 1m ngoài trời Lixin màu Trắng');
  await m.goi('B');
  expect(m.tinGui.at(-1)).toMatch(/mấy cái/);
  await m.goi('160');
  const phien = m.db.rows.get('c1')?.slots as { dong: Array<{ sl: number | null; donGia?: number; daChot?: { id: number } }> };
  // "160" phải vào SỐ LƯỢNG, KHÔNG được thành giá 160đ.
  expect(phien.dong[0]).toMatchObject({ sl: 160, daChot: { id: 552 } });
  expect(phien.dong[0].donGia).toBeUndefined();
  expect(m.tinGui.at(-1)).toContain('chưa có giá');
  expect(m.odoo.execute).not.toHaveBeenCalled();
}

const dongGhi = (m: ReturnType<typeof dungMay>) =>
  m.odoo.execute.mock.calls.filter((c) => c[0] === 'sale.order.line' && c[1] === 'create');

describe('replay 26/08 — trả lời câu hỏi giá phải vào đúng dòng đang chờ', () => {
  it('"Giá 13k" (con số trần, không tên) → ghi dòng 160 × 13.000đ, KHÔNG hỏi lại', async () => {
    const m = dungMay();
    await toiLucHoiGia(m);
    await m.goi('Giá 13k');
    expect(m.tinGui.at(-1)).not.toMatch(/chưa khớp được|chưa có giá/);
    const ghi = dongGhi(m);
    expect(ghi.length).toBe(1);
    expect((ghi[0][2] as unknown[])[0]).toMatchObject({ product_id: 552, product_uom_qty: 160, price_unit: 13000 });
    expect(m.log.map((l) => l.toolName)).toContain('sua_don');
  });

  it('"led thanh toả trắng 12v lixin giá 13k" (tên không khớp hết token) → vẫn vào dòng chờ duy nhất', async () => {
    const m = dungMay();
    await toiLucHoiGia(m);
    await m.goi('led thanh toả trắng 12v lixin giá 13k');
    expect(m.tinGui.at(-1)).not.toMatch(/chưa khớp được|chưa có giá/);
    expect((dongGhi(m)[0][2] as unknown[])[0]).toMatchObject({ product_id: 552, price_unit: 13000 });
  });

  it('câu trả lời giá KHÔNG tốn lượt LLM', async () => {
    const m = dungMay();
    await toiLucHoiGia(m);
    const truoc = m.soLanGoi();
    await m.goi('13k/thanh');
    expect(m.soLanGoi()).toBe(truoc);
    expect((dongGhi(m)[0][2] as unknown[])[0]).toMatchObject({ price_unit: 13000 });
  });
});
