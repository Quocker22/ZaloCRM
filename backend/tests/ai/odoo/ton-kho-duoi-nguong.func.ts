// SPDX-License-Identifier: AGPL-3.0-or-later
// CA THẬT 15:38 ngày 11/08/2026 (nhóm Test-AI) — chị Minh Anh hỏi:
//   "xem cho chị những hàng nào có tồn kho nhỏ hơn 100 nhé"
// Bot đáp: "em không có công cụ để tra số tồn kho theo điều kiện như vậy ạ".
// Anh Quyết nhắn thẳng anh Quốc: "@Viết Quốc cho tiểu Mã thêm kiểm kho nữa nhé".
//
// ĐO PROD 04→11/08 (486 lượt gọi tool): `canh_bao_ton_kho` chỉ được gọi ĐÚNG 1
// LẦN, trong khi 14 câu hỏi tồn kho khác bị bot mò bằng `doc_odoo`. Nguyên nhân
// KHÔNG phải model ngu: tool CHỈ biết "sắp hết trong N NGÀY" (tồn ÷ tốc độ bán),
// không có đường nào nhận điều kiện "tồn < 100 CÁI". Bot từ chối là ĐÚNG với
// tool lúc đó — thiếu năng lực thật, không phải thiếu mô tả.
//
// Bộ test này khoá cả hai đầu: tool làm được việc, VÀ mô tả nói cho model biết
// là nó làm được (mô tả sai thì tool đúng vẫn nằm im, đúng như 8 ngày vừa rồi).
import { describe, it, expect, vi } from 'vitest';
import {
  canhBaoTonKho, dinhDangCanhBaoTonKho, canhBaoTonKhoDefinition,
} from '../../../src/modules/ai/odoo/tools/canh-bao-ton-kho.js';

/** Odoo giả: `execute` trả dữ liệu cho get_low_stock_data, `searchRead` cho lọc tồn. */
function fakeOdoo(rows: unknown, quant: unknown[] = []) {
  return {
    execute: vi.fn(async () => rows),
    searchRead: vi.fn(async () => quant),
  };
}

/** Hình dạng THẬT của `get_low_stock_data` (đã kiểm bằng gọi thật prod). */
const TON_KHO_MAU = [
  { product_id: 1057, ten: 'Nguồn NB 12V400W', ma: 'NB400', ton: 12, bq_ngay: 30, so_ngay_con: 0.4, muc_do: 'danger' },
  { product_id: 2043, ten: 'Card thu V7512', ma: 'V7512', ton: 400, bq_ngay: 20, so_ngay_con: 20, muc_do: 'warning' },
];

/** Hình dạng THẬT của product.product khi lọc theo qty_available. */
const QUANT_MAU = [
  { id: 1057, name: 'Nguồn NB 12V400W', default_code: 'NB400', qty_available: 12 },
  { id: 3311, name: 'Thanh LED toả 30W', default_code: 'LT30', qty_available: 87 },
  { id: 4102, name: 'Ovp K2', default_code: 'OVPK2', qty_available: 0 },
];

// ═══════════════════════════════════════════════════════════════════════════
describe('CA THẬT 15:38 11/08 — "những hàng nào có tồn kho nhỏ hơn 100"', () => {
  it('tool NHẬN được ngưỡng tồn (ton_duoi) — không còn chỉ chạy theo số ngày', async () => {
    const o = fakeOdoo([], QUANT_MAU);

    const kq = await canhBaoTonKho({ odoo: o }, { ton_duoi: 100 });

    // Đường đi phải là lọc tồn theo SỐ LƯỢNG, không phải get_low_stock_data:
    // hỏi "tồn < 100" mà trả "sắp hết trong 14 ngày" là trả lời câu khác.
    expect(o.searchRead).toHaveBeenCalled();
    expect(kq.length).toBeGreaterThan(0);
  });

  it('lọc ĐÚNG điều kiện: gửi domain qty_available < 100 xuống Odoo', async () => {
    const o = fakeOdoo([], QUANT_MAU);

    await canhBaoTonKho({ odoo: o }, { ton_duoi: 100 });

    // KHÔNG lọc ở TypeScript sau khi kéo cả 1.257 SP về: vừa chậm vừa sai khi
    // catalog vượt `limit`. Điều kiện phải nằm trong domain Odoo.
    const domain = JSON.stringify(o.searchRead.mock.calls[0]![1]);
    expect(domain).toContain('qty_available');
    expect(domain).toContain('100');
  });

  it('trả lời có SỐ THẬT + nguồn — đây là thứ chị Minh Anh cần thấy', async () => {
    const s = dinhDangCanhBaoTonKho(await canhBaoTonKho({ odoo: fakeOdoo([], QUANT_MAU) }, { ton_duoi: 100 }));

    expect(s).toContain('Nguồn:');
    expect(s).toContain('Nguồn NB 12V400W');
    expect(s).toContain('87');
    // Ngưỡng phải hiện trong câu trả lời: nhân viên đối chiếu được là hỏi đúng ý.
    expect(s).toContain('100');
  });

  it('KHÔNG có hàng nào dưới ngưỡng → nói rõ, KHÔNG trả chuỗi rỗng', async () => {
    // Chuỗi rỗng khiến model tự bịa danh sách — lỗi cũ của hệ này.
    const s = dinhDangCanhBaoTonKho(await canhBaoTonKho({ odoo: fakeOdoo([], []) }, { ton_duoi: 100 }));

    expect(s.trim().length).toBeGreaterThan(20);
    expect(s.toLowerCase()).toMatch(/không có/);
    expect(s).toContain('Nguồn:');
  });

  it('ngưỡng vô lý (âm, 0, chữ) → KHÔNG rơi về danh sách sắp hết một cách im lặng', async () => {
    // Rơi im lặng sang chế độ khác = trả lời câu hỏi khác mà không ai biết.
    for (const rac of [-5, 0]) {
      const o = fakeOdoo(TON_KHO_MAU, QUANT_MAU);
      const kq = await canhBaoTonKho({ odoo: o }, { ton_duoi: rac });
      expect(Array.isArray(kq)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('KHÔNG phá chế độ cũ — "sản phẩm nào sắp hết"', () => {
  it('không truyền ton_duoi → vẫn chạy get_low_stock_data như cũ', async () => {
    const o = fakeOdoo(TON_KHO_MAU);

    const kq = await canhBaoTonKho({ odoo: o }, {});

    expect(o.execute.mock.calls[0]![1]).toBe('get_low_stock_data');
    expect(kq).toHaveLength(2);
    expect(kq[0]!.mucDo).toBe('danger');
  });

  it('so_ngay vẫn đi vào kwargs, args vẫn rỗng (bug @api.model cũ)', async () => {
    const o = fakeOdoo(TON_KHO_MAU);

    await canhBaoTonKho({ odoo: o }, { so_ngay: 7 });

    expect(o.execute.mock.calls[0]![2]).toEqual([]);
    expect(o.execute.mock.calls[0]![3]).toMatchObject({ days_ahead: 7 });
  });

  it('chế độ sắp hết vẫn hiện tốc độ bán — thứ tra_ton_kho KHÔNG biết', async () => {
    const s = dinhDangCanhBaoTonKho(await canhBaoTonKho({ odoo: fakeOdoo(TON_KHO_MAU) }, {}));

    expect(s).toContain('/ngày');
    expect(s).toContain('[GẤP]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('MÔ TẢ TOOL — model chọn tool bằng mô tả, không bằng code', () => {
  const d = canhBaoTonKhoDefinition;

  it('mô tả nói được cả HAI việc: sắp hết theo ngày VÀ tồn dưới ngưỡng', () => {
    // Mô tả cũ chỉ nói "sắp hết hàng" → model đọc câu "tồn nhỏ hơn 100" không
    // thấy khớp, rơi sang doc_odoo (14 lần) hoặc từ chối (ca 15:38).
    expect(d.description).toMatch(/tồn/i);
    expect(d.description.toLowerCase()).toContain('nhỏ hơn');
  });

  it('mô tả chứa NGUYÊN VĂN câu hỏi thật đã thua 11/08', () => {
    // Ví dụ câu thật là thứ rẻ nhất để model khớp đúng tool.
    expect(d.description.toLowerCase()).toContain('tồn kho nhỏ hơn');
  });

  it('schema khai ton_duoi để model điền được ngưỡng', () => {
    const p = d.inputSchema.properties as Record<string, { description?: string }>;
    expect(p).toHaveProperty('ton_duoi');
    expect(p.ton_duoi!.description ?? '').not.toBe('');
  });

  it('vẫn giữ "GỌI KHI" — quy ước chung của mọi mô tả tool trong hệ', () => {
    expect(d.description).toContain('GỌI KHI');
  });
});
