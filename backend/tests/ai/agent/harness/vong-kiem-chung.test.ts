// SPDX-License-Identifier: AGPL-3.0-or-later
// Harness vòng kiểm chứng (27/08): model đi nhiều vòng với tool CHỈ ĐỌC rồi
// phải chốt bằng tool cuối; hết vòng thì ép; lặp tool thì chặn; hết giờ thì
// trả khong_chot cho caller fail-open.
import { describe, it, expect, vi } from 'vitest';
import { chayVongKiemChung, catGon } from '../../../../src/modules/ai/agent/harness/vong-kiem-chung.js';
import type { AgentTurn, ToolDefinition } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const turnTools = (calls: Array<{ name: string; input: Record<string, unknown> }>): AgentTurn => ({
  text: '', stopReason: 'tool_use', raw: [{ type: 'tool_calls' }], usage,
  toolCalls: calls.map((c, i) => ({ id: `t${i}`, name: c.name, input: c.input })),
});
const turnText = (text: string): AgentTurn => ({ text, stopReason: 'end_turn', raw: null, usage, toolCalls: [] });

const PHAN_QUYET: ToolDefinition = { name: 'phan_quyet', description: 'chốt', inputSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] } };
const DOC: ToolDefinition = { name: 'doc_odoo', description: 'đọc', inputSchema: { type: 'object', properties: { bang: { type: 'string' } }, required: ['bang'] } };

describe('chayVongKiemChung', () => {
  it('ca 10:36 26/08: vòng 1 tra đơn S15274 → thấy chủ đơn là Tấn Anh → vòng 2 chốt ok=false; bằng chứng được ghi, reasoning bật', async () => {
    const run = vi.fn(async () => 'S15274 | partner: Tấn Anh - Bình Định | 1.433.456đ');
    const generate = vi.fn()
      .mockResolvedValueOnce(turnTools([{ name: 'doc_odoo', input: { bang: 'sale.order', loc: [['name', '=', 'S15274']] } }]))
      .mockResolvedValueOnce(turnTools([{ name: 'phan_quyet', input: { ok: false, loi: ['bia_so'], ly_do: 'đơn S15274 của Tấn Anh, không phải QC Bách Phát' } }]));
    const kq = await chayVongKiemChung({
      generate, system: 'giám sát', userMessage: 'bản nháp: đã in đơn QC Bách Phát (S15274)',
      kiemChung: [{ definition: DOC, run }], toolCuoi: PHAN_QUYET,
    });
    expect(kq.nguon).toBe('chot');
    expect(kq.chot).toMatchObject({ ok: false });
    expect(kq.soVong).toBe(2);
    expect(kq.bangChung).toHaveLength(1);
    expect(kq.bangChung[0].output).toContain('Tấn Anh');
    expect(generate.mock.calls[0][0].suyNghi).toBe(true);
    // Vòng 2 phải thấy kết quả tool trong messages.
    const msgs2 = generate.mock.calls[1][0].messages;
    expect(JSON.stringify(msgs2)).toContain('Tấn Anh');
  });

  it('chốt ngay vòng 1 không cần kiểm → 1 vòng, không bằng chứng', async () => {
    const generate = vi.fn().mockResolvedValueOnce(turnTools([{ name: 'phan_quyet', input: { ok: true } }]));
    const kq = await chayVongKiemChung({ generate, system: 's', userMessage: 'u', kiemChung: [], toolCuoi: PHAN_QUYET });
    expect(kq).toMatchObject({ nguon: 'chot', soVong: 1, bangChung: [] });
  });

  it('hết 3 vòng chưa chốt → lượt ÉP chỉ có tool cuối → ep_chot; gọi tool y hệt lần trước bị chặn không chạy lại', async () => {
    const run = vi.fn(async () => 'kq');
    const generate = vi.fn()
      .mockResolvedValueOnce(turnTools([{ name: 'doc_odoo', input: { bang: 'a' } }]))
      .mockResolvedValueOnce(turnTools([{ name: 'doc_odoo', input: { bang: 'a' } }]))
      .mockResolvedValueOnce(turnTools([{ name: 'doc_odoo', input: { bang: 'b' } }]))
      .mockResolvedValueOnce(turnTools([{ name: 'phan_quyet', input: { ok: true } }]));
    const kq = await chayVongKiemChung({ generate, system: 's', userMessage: 'u', kiemChung: [{ definition: DOC, run }], toolCuoi: PHAN_QUYET });
    expect(kq.nguon).toBe('ep_chot');
    expect(run).toHaveBeenCalledTimes(2); // lần 2 trùng tham số → không chạy
    expect(kq.bangChung[1].output).toContain('y hệt');
    expect(generate.mock.calls[3][0].tools.map((t: ToolDefinition) => t.name)).toEqual(['phan_quyet']);
  });

  it('model trả text không gọi gì → nhắc chốt; hết giờ → khong_chot, không ném', async () => {
    const generate = vi.fn().mockResolvedValueOnce(turnText('Tôi nghĩ…')).mockResolvedValueOnce(turnTools([{ name: 'phan_quyet', input: { ok: true } }]));
    const a = await chayVongKiemChung({ generate, system: 's', userMessage: 'u', kiemChung: [], toolCuoi: PHAN_QUYET });
    expect(a.nguon).toBe('chot');
    // Hết giờ ngay vòng đầu → vẫn ÉP CHỐT nhanh một lượt (tắt reasoning); ép ra tool → ep_chot.
    const treoRoiChot = vi.fn()
      .mockImplementationOnce(() => new Promise<AgentTurn>(() => {}))
      .mockResolvedValueOnce(turnTools([{ name: 'phan_quyet', input: { ok: true } }]));
    const b = await chayVongKiemChung({ generate: treoRoiChot, system: 's', userMessage: 'u', kiemChung: [], toolCuoi: PHAN_QUYET, timeoutMs: 600 });
    expect(b.nguon).toBe('ep_chot');
    expect(treoRoiChot.mock.calls[1][0].suyNghi).toBe(false);
    // Ép cũng treo → khong_chot (ép có 8s riêng; ở test dùng mock trả text ngay để khỏi chờ).
    const treoCa = vi.fn()
      .mockImplementationOnce(() => new Promise<AgentTurn>(() => {}))
      .mockResolvedValueOnce(turnText('không'));
    const c = await chayVongKiemChung({ generate: treoCa, system: 's', userMessage: 'u', kiemChung: [], toolCuoi: PHAN_QUYET, timeoutMs: 600 });
    expect(c.nguon).toBe('khong_chot');
  });

  it('catGon cắt kết quả dài và ghi rõ đã cắt', () => {
    expect(catGon('x'.repeat(50), 100)).toBe('x'.repeat(50));
    expect(catGon('y'.repeat(1000), 100)).toMatch(/^y{100}\n…\(cắt 900 ký tự\)$/);
  });
});
