// SPDX-License-Identifier: AGPL-3.0-or-later
// Giám sát + harness (27/08): có Odoo chỉ-đọc → model tra đơn/khách TRƯỚC khi
// phán. Ca thật 10:36 26/08: bản nháp "đã in đơn QC Bách Phát" nhưng tool in
// S15274 — giám sát một phát bỏ qua; có vòng kiểm chứng thì bắt được.
import { describe, it, expect, vi } from 'vitest';
import { giamSatTraLoi } from '../../../src/modules/ai/agent/giam-sat.js';
import type { AgentTurn } from '../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const turnTools = (calls: Array<{ name: string; input: Record<string, unknown> }>): AgentTurn => ({
  text: '', stopReason: 'tool_use', raw: [{ type: 'x' }], usage,
  toolCalls: calls.map((c, i) => ({ id: `t${i}`, name: c.name, input: c.input })),
});

const LOG = [{
  toolName: 'in_hoa_don', input: { ma_don: 'S15274' },
  output: 'Đã xếp hàng in hoá đơn INV/2026/028301 (đơn S15274) · Tấn Anh - Bình Định · 1.433.456đ — bản KHÔNG GIÁ.',
  thanhCong: true, durationMs: 300, iteration: 1,
}];
const VAO = {
  cauNv: 'in đơn QC bách phát không in giá', lichSu: [], log: LOG,
  traLoi: 'Em đã xếp hàng in lại đơn QC Bách Phát - Xã Đàn (0869130883) bản KHÔNG GIÁ ra máy in rồi ạ.',
};

describe('giamSatTraLoi + harness', () => {
  it('ca 10:36: vòng 1 doc_odoo S15274 → chủ đơn Tấn Anh → vòng 2 phán bia_so; bằng chứng vào phán quyết và lý do; tool được cấp là CHỈ ĐỌC', async () => {
    const searchRead = vi.fn(async () => [{ id: 28192, name: 'S15274', partner_id: [3006, 'Tấn Anh - Bình Định'], state: 'sale', amount_total: 1433456 }]);
    const generate = vi.fn()
      .mockResolvedValueOnce(turnTools([{ name: 'doc_odoo', input: { bang: 'sale.order', loc: [['name', '=', 'S15274']], cot: ['name', 'partner_id'] } }]))
      .mockResolvedValueOnce(turnTools([{ name: 'phan_quyet', input: {
        ok: false, loi: ['bia_so'], ly_do: 'S15274 là của Tấn Anh - Bình Định, không phải QC Bách Phát',
        tra_loi_sua: 'Dạ em vừa xếp in nhầm: S15274 là đơn của Tấn Anh - Bình Định (INV/2026/028301 · 1.433.456đ), không phải QC Bách Phát. Anh/chị cho em mã đơn của QC Bách Phát để in đúng ạ.',
      } }]));
    const pq = await giamSatTraLoi(generate, VAO, 5000, { odoo: { searchRead, execute: vi.fn() } as never });
    expect(pq.nguon).toBe('llm');
    expect(pq.ok).toBe(false);
    expect(pq.loi).toEqual(['bia_so']);
    expect(pq.soVong).toBe(2);
    expect(pq.bangChung?.[0]).toMatchObject({ tool: 'doc_odoo' });
    expect(pq.bangChung?.[0].output).toContain('Tấn Anh');
    expect(pq.lyDo).toContain('kiểm chứng');
    expect(pq.traLoiSua).toContain('Tấn Anh');
    // Bộ tool đưa cho model vòng 1: chỉ-đọc + phan_quyet, không có tool ghi.
    const ten = generate.mock.calls[0][0].tools.map((t: { name: string }) => t.name);
    expect(ten).toEqual(expect.arrayContaining(['tra_khach_hang', 'tra_san_pham', 'doc_odoo', 'phan_quyet']));
    expect(ten.some((n: string) => /^(sua_don|tao_don|xuat_hoa_don|lam_odoo|in_hoa_don)/.test(n))).toBe(false);
    expect(generate.mock.calls[0][0].suyNghi).toBe(true);
  });

  it('không có deps → một lượt như cũ (không tool kiểm chứng), vẫn ra phán quyết', async () => {
    const generate = vi.fn().mockResolvedValueOnce(turnTools([{ name: 'phan_quyet', input: { ok: true, loi: [] } }]));
    const pq = await giamSatTraLoi(generate, VAO);
    expect(pq.ok).toBe(true);
    expect(pq.soVong).toBe(1);
    expect(generate.mock.calls[0][0].tools.map((t: { name: string }) => t.name)).toEqual(['phan_quyet']);
  });

  it('có deps nhưng model tra rồi hết giờ → ÉP CHỐT nhanh (không reasoning); ép cũng không ra tool → fail-open, không ném', async () => {
    const searchRead = vi.fn(async () => []);
    const generate = vi.fn()
      .mockResolvedValueOnce(turnTools([{ name: 'tra_khach_hang', input: { ten: 'QC bách phát' } }]))
      .mockImplementationOnce(() => new Promise<AgentTurn>(() => {}))
      .mockResolvedValueOnce({ text: 'không biết', stopReason: 'end_turn', raw: null, usage, toolCalls: [] });
    const pq = await giamSatTraLoi(generate, VAO, 900, { odoo: { searchRead, execute: vi.fn() } as never });
    expect(pq.nguon).toBe('fail_open');
    expect(pq.bangChung).toHaveLength(1);
    // Lượt ép: chỉ tool cuối, TẮT reasoning.
    const ep = generate.mock.calls[2][0];
    expect(ep.tools.map((t: { name: string }) => t.name)).toEqual(['phan_quyet']);
    expect(ep.suyNghi).toBe(false);
  });

  it('CODE tự tra chủ đơn theo mã + phát hiện tên khách lệch → prompt mang bằng chứng, không chờ model có sáng kiến', async () => {
    const searchRead = vi.fn(async (model: string) => model === 'sale.order'
      ? [{ id: 28192, name: 'S15274', partner_id: [3006, 'Tấn Anh - Bình Định'], state: 'sale', amount_total: 1433456 }] : []);
    const generate = vi.fn().mockResolvedValueOnce(turnTools([{ name: 'phan_quyet', input: { ok: false, loi: ['bia_so'], tra_loi_sua: 'Dạ S15274 là đơn của Tấn Anh - Bình Định (1.433.456đ), không phải QC Bách Phát — em chưa in đúng đơn. Anh/chị cho em mã đơn QC Bách Phát ạ.' } }]));
    const pq = await giamSatTraLoi(generate, VAO, 5000, { odoo: { searchRead, execute: vi.fn() } as never });
    const nd = String(generate.mock.calls[0][0].messages[0].content);
    expect(nd).toContain('BẰNG CHỨNG CODE ĐÃ TRA ODOO');
    expect(nd).toContain('S15274 → khách "Tấn Anh - Bình Định"');
    expect(nd).toContain('output tool nói tới khách "Tấn Anh - Bình Định" nhưng bản nháp KHÔNG nhắc');
    expect(pq.ok).toBe(false);
    expect(pq.traLoiSua).toContain('Tấn Anh');
  });
});
