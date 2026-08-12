// SPDX-License-Identifier: AGPL-3.0-or-later
// REPLAY CA THẬT — nhóm bán hàng, 11:41-11:43 ngày 12/08/2026.
//
// BOT TỰ XOÁ THÔNG TIN KHÁCH GIỮA CHỪNG:
//
//   11:41:52  NV : [Ảnh] "@bot lấy data ở cột diễn Giải lên đơn cho Led Kim Long"
//   11:42:07  Bot: "Em bỏ đơn đang gom dở nhé. Em không tìm thấy sản phẩm: ..."
//   11:42:50  NV : "@bot có sản phẩm nào gần giống không"
//   11:43:29  Bot: (liệt kê SP gần giống, hỏi xác nhận)
//   11:43:56  NV : "@bot đúng rồi lên đơn đi"
//   11:43:58  Bot: "Em bỏ đơn đang gom dở nhé. Đơn này lên cho khách nào ạ?"
//                  ↑ XOÁ MẤT "Led Kim Long" đã cho từ 11:41
//
// Anh Quốc: "là sao nữa nhỉ?? rõ ràng là đã có thông tin khách hàng là led kim
// long rồi mà". Đúng — khách đã chốt, SP vừa chọn xong, chỉ còn gật một cái là
// ra đơn; thay vào đó bot vứt sạch phiên và hỏi lại từ đầu.
//
// NGUYÊN NHÂN: ĐƯỜNG THOÁT 1 trong gom-don/index.ts — "lệnh LÊN ĐƠN MỚI đè
// phiên đang gom". Nó nhận lệnh bằng `NHAN_LENH_LEN_DON`:
//
//   /(?:^|\s)(?:lên|len|tạo|tao|đặt|dat)\s+(?:đơn|don|hàng|hang)\b/i
//
// Câu "đúng rồi lên đơn đi" CHỨA "lên đơn" → regex khớp → coi là việc MỚI →
// xoá phiên. Nhưng đó không phải việc mới, đó là câu GẬT cho đúng việc đang
// làm. Regex chỉ đọc được ĐỘNG TỪ, không đọc được có KHÁCH MỚI hay không.
//
// BUG DEMO 17:22 10/08 — RÀNG BUỘC NGƯỢC LẠI, ĐỪNG PHÁ:
//   Phiên dính SP giá 1đ, nhân viên gõ "lên đơn cho anh Hoàng 10 cái nguồn NB"
//   — khách KHÁC HẲN — mà bot vẫn trả đơn anh Vấn kèm nguyên câu lỗi cũ. Nói
//   "lên đơn cho <người khác>" LÀ bắt đầu việc mới, phiên cũ phải bỏ.
//
// Lời giải phải phân biệt được HAI câu cùng chứa chữ "lên đơn":
//   "lên đơn cho anh Hoàng 10 cái nguồn NB"  (có KHÁCH MỚI)  → ĐÈ phiên
//   "đúng rồi lên đơn đi"                    (chỉ là gật)    → GIỮ phiên
import { describe, it, expect, vi } from 'vitest';
import { xuLyGomDon, type GomDonDeps } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/index.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function fakeGenerate(slots: Record<string, unknown>[]): ToolAwareGenerate {
  let i = 0;
  return async () => {
    const input = slots[Math.min(i++, slots.length - 1)];
    return {
      text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't', name: 'ghi_slot', input }],
    };
  };
}

/**
 * Odoo giả cho ca thật: khách "Led Kim Long" + một SP để chốt.
 *
 * `timDuocSp=false` tái hiện đúng bước 11:42:07 của ca thật ("Em không tìm
 * thấy sản phẩm: ..."): SP KHÔNG khớp nên phiên CÒN MỞ với khách đã có. Đây là
 * điều kiện bắt buộc để tái hiện lỗi — SP khớp ngay thì đơn ra luôn ở lượt
 * đầu, phiên chết, và lượt gật sau không còn gì để mất.
 *
 * `sale.order` create tăng dần id để đếm đúng số đơn đã ghi.
 */
function fakeOdoo(timDuocSp = true) {
  const kh = [{ id: 88, name: 'Công Ty Led Kim Long', ref: 'KH000088', phone: false }];
  const SP = {
    id: 701, name: 'Led Bulb 9W Trắng', default_code: 'SP000701',
    list_price: 50000, uom_id: [1, 'Cái'],
  };
  const donDaGhi = new Map<string, { id: number; name: string }>();
  let idKe = 27001;
  return {
    searchRead: vi.fn(async (model: string, domain: unknown[], fields?: unknown) => {
      const d = JSON.stringify(domain);
      if (model === 'res.partner') return kh;
      if (model === 'product.product') {
        if (!timDuocSp) return [];
        if (JSON.stringify(fields ?? []).includes('incokit_stock_breakdown')) {
          return [{ id: SP.id, name: SP.name, incokit_stock_breakdown: [] }];
        }
        const g = (domain as unknown[]).find(
          (x): x is [string, string, number] => Array.isArray(x) && x[0] === 'list_price');
        if (g && g[1] === '<=') return [];
        return [SP];
      }
      if (model === 'sale.order') {
        if (d.includes('client_order_ref')) {
          const m = d.match(/zalo:[^"]+/);
          const cu = m ? donDaGhi.get(m[0]) : undefined;
          return cu ? [{ ...cu, state: 'draft', amount_total: 500000, client_order_ref: m![0] }] : [];
        }
        const mid = (domain as unknown[]).find(
          (x): x is [string, string, number] => Array.isArray(x) && x[0] === 'id');
        const id = mid ? Number(mid[2]) : idKe - 1;
        return [{
          id, name: `S${14000 + (id - 27001)}`, state: 'draft',
          amount_total: 500000, amount_untaxed: 500000,
        }];
      }
      return [];
    }),
    execute: vi.fn(async (model: string, method: string, args?: unknown) => {
      if (model === 'sale.order' && method === 'create') {
        const vals = (args as Array<Record<string, unknown>>)[0];
        const id = idKe++;
        donDaGhi.set(String(vals.client_order_ref ?? ''), { id, name: `S${14000 + (id - 27001)}` });
        return id;
      }
      return idKe;
    }),
  };
}

function fakeDb() {
  const rows = new Map<string, { orgId: string; conversationId: string; slots: unknown; hetHan: Date }>();
  return {
    store: rows,
    db: {
      phienGomDon: {
        findUnique: async ({ where }: { where: { conversationId: string } }) =>
          rows.get(where.conversationId) ?? null,
        upsert: async ({ where, create, update }: {
          where: { conversationId: string }; create: never;
          update: { slots: unknown; hetHan: Date };
        }) => {
          const cu = rows.get(where.conversationId);
          rows.set(where.conversationId, cu ? { ...cu, ...update } : create);
          return create;
        },
        deleteMany: async ({ where }: { where: { conversationId: string } }) => {
          rows.delete(where.conversationId); return { count: 1 };
        },
      },
    },
  };
}

function dungMay(
  slots: Record<string, unknown>[],
  conversationId = 'c-mat-khach-12-08',
  timDuocSp = true,
) {
  const odoo = fakeOdoo(timDuocSp);
  const { store, db } = fakeDb();
  const tinGui: string[] = [];
  const deps: GomDonDeps = {
    prisma: db as never, odoo: odoo as never, generate: fakeGenerate(slots),
    anhClient: null, odooUrl: 'https://odoo.example.com',
    guiTin: async (t) => { tinGui.push(t); },
    guiAnhHoaDon: async () => {}, ghiLog: () => {},
  };
  return {
    goi: (cau: string, seq: number) => xuLyGomDon(deps, {
      orgId: 'o1', conversationId, seq, cau, senderUid: 'uid-nv',
    }),
    tinGui,
    odoo,
    /** Phiên còn sống trong DB giả (đọc thô để soi khách đã chốt). */
    phien: () => {
      const r = store.get(conversationId);
      return r ? (r.slots as { khachTuKhoa?: string | null; khachDaChot?: { ten: string } }) : null;
    },
  };
}

const soDonDaTao = (odoo: ReturnType<typeof fakeOdoo>): number =>
  odoo.execute.mock.calls.filter(
    (c) => String(c[0]) === 'sale.order' && String(c[1]) === 'create',
  ).length;

/** Câu "Em bỏ đơn đang gom dở nhé" — dấu hiệu ĐƯỜNG THOÁT 1 vừa xoá phiên. */
const soLanBoPhien = (tinGui: string[]): number =>
  tinGui.filter((t) => t.includes('bỏ đơn đang gom dở')).length;

describe('CA THẬT 11:41-11:43 12/08 — "đúng rồi lên đơn đi" xoá mất khách Led Kim Long', () => {
  it('GIỮ phiên: câu gật có chữ "lên đơn" nhưng KHÔNG có khách mới', async () => {
    // 11:41:52 — lệnh mở phiên, khách "Led Kim Long", SP chưa khớp.
    // 11:43:56 — nhân viên gật: "đúng rồi lên đơn đi".
    // `timDuocSp=false` là điều kiện BẮT BUỘC (xem comment fakeOdoo): SP khớp
    // ngay thì đơn ra luôn ở lượt đầu, phiên chết, lượt gật sau không còn gì
    // để mất — test tự xanh mà không kiểm được gì.
    const { goi, tinGui, phien } = dungMay([
      { lenDon: true, khach: 'Led Kim Long', dong: [{ sp: 'led bulb 9w trắng', sl: 10 }] },
      { xacNhan: true },
    ], 'c-mat-khach-12-08', false);

    await goi('lấy data ở cột diễn Giải lên đơn cho Led Kim Long', 8001);
    const truoc = phien();
    expect(truoc).not.toBeNull(); // phiên đã mở, khách đã vào

    await goi('đúng rồi lên đơn đi', 8002);

    // ĐÂY LÀ CÁI ĐỎ: trước vá, ĐƯỜNG THOÁT 1 khớp "lên đơn" → xoá sạch phiên,
    // bot hỏi lại "Đơn này lên cho khách nào ạ?" và mất "Led Kim Long".
    expect(soLanBoPhien(tinGui)).toBe(0);
    expect(tinGui.join('\n')).not.toContain('lên cho khách nào');
  });

  it('các cách gật khác cũng KHÔNG được xoá phiên', async () => {
    // Cùng một bệnh, nhiều cách nói. Tất cả đều chứa động từ lên/tạo đơn mà
    // KHÔNG mang khách mới nào.
    for (const cau of ['ok lên đơn đi', 'chốt lên đơn nhé', 'đúng rồi tạo đơn đi', 'lên đơn đi em']) {
      const { goi, tinGui } = dungMay([
        { lenDon: true, khach: 'Led Kim Long', dong: [{ sp: 'led bulb 9w trắng', sl: 10 }] },
        { xacNhan: true },
      ], `c-gat-${cau}`);
      await goi('lên đơn cho Led Kim Long 10 cái led bulb 9w trắng', 9001);
      await goi(cau, 9002);
      expect(soLanBoPhien(tinGui), `câu "${cau}" không được xoá phiên`).toBe(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RÀNG BUỘC NGƯỢC — bản vá KHÔNG được làm sống lại bug demo 17:22 10/08.
describe('KHÔNG được dính phiên cũ (bug demo 17:22 10/08)', () => {
  it('"lên đơn cho anh Hoàng ..." — khách KHÁC → VẪN đè phiên', async () => {
    const { goi, tinGui } = dungMay([
      { lenDon: true, khach: 'Led Kim Long', dong: [{ sp: 'led bulb 9w trắng', sl: 10 }] },
      { lenDon: true, khach: 'Hoàng', dong: [{ sp: 'nguồn nb', sl: 10 }] },
    ], 'c-de-hoang', false);
    await goi('lên đơn cho Led Kim Long 10 cái led bulb 9w trắng', 10001);
    await goi('lên đơn cho anh Hoàng 10 cái nguồn NB', 10002);

    // Việc MỚI, khách KHÁC HẲN → phiên cũ phải bỏ và báo cho nhân viên biết.
    expect(soLanBoPhien(tinGui)).toBe(1);
  });

  it('lệnh lên đơn có khách mới khi CHƯA có phiên → chạy bình thường, không báo bỏ phiên', async () => {
    const { goi, tinGui } = dungMay([
      { lenDon: true, khach: 'Hoàng', dong: [{ sp: 'nguồn nb', sl: 10 }] },
    ]);
    await goi('lên đơn cho anh Hoàng 10 cái nguồn NB', 11001);
    expect(soLanBoPhien(tinGui)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// HAI LỖI GẶP NHAU — câu gật vừa phải GIỮ phiên (lỗi 2) vừa không được đẻ
// đơn thứ hai (lỗi 1). Đây đúng hình dạng ca thật: nhân viên gật bằng câu có
// chữ "lên đơn", rồi gật thêm lần nữa.
describe('gật bằng câu có chữ "lên đơn" → giữ phiên VÀ đúng một đơn', () => {
  it('"đúng rồi lên đơn đi" hai lần → 1 đơn, phiên không bị xoá giữa chừng', async () => {
    const { goi, tinGui, odoo } = dungMay([
      { lenDon: true, khach: 'Led Kim Long', dong: [{ sp: 'led bulb 9w trắng', sl: 10, gia: 50000 }] },
      { xacNhan: true },
      { xacNhan: true },
    ]);
    await goi('lên đơn cho Led Kim Long 10 cái led bulb 9w trắng giá 50k', 12001);
    await goi('đúng rồi lên đơn đi', 12002);
    await goi('đúng rồi lên đơn đi', 12003);

    expect(soLanBoPhien(tinGui)).toBe(0);
    expect(soDonDaTao(odoo)).toBeLessThanOrEqual(1);
  });
});
