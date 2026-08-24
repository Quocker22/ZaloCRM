// SPDX-License-Identifier: AGPL-3.0-or-later
// Ca thật 17:50 24/08: NV hỏi LẠI "thông số kỹ thuật đầu xử lý ovp-k10p" —
// model thấy câu trả lời cũ trong lịch sử nên trả lời thẳng, KHÔNG gọi
// tra_tri_thuc → auto-đính trong tool không chạy, file vẫn không tới
// (anh Quốc: "có thấy đính kèm pdf đâu????"). Hàng rào giờ ở TẦNG LUỒNG.
import { describe, it, expect, vi } from 'vitest';
import { chayLenhNhanVien } from '../../../src/modules/ai/agent/staff-agent.js';
import type { AgentTurn } from '../../../src/modules/ai/agent/types.js';
import type { OdooClient } from '../../../src/modules/ai/odoo/client.js';
import type { TaiLieu } from '../../../src/modules/ai/odoo/tools/gui-tai-lieu.js';

const fakeOdoo = () =>
  ({ searchRead: vi.fn(async () => []), execute: vi.fn(async () => 1) }) as unknown as OdooClient;

const turnXong = (text: string): AgentTurn => ({
  text, toolCalls: [], stopReason: 'end_turn', raw: [{ type: 'text', text }],
});

const KHO: TaiLieu[] = [
  { tieuDe: 'K10P.pdf', duongDan: 'http://x/k10p.pdf', kichThuoc: 100 },
  { tieuDe: 'K10.pdf', duongDan: 'http://x/k10.pdf', kichThuoc: 100 },
];

const depsCoKho = (generate: unknown) => ({
  odoo: fakeOdoo(),
  generate,
  ghiNhanChuyenSale: vi.fn(async () => {}),
  lietTaiLieu: async () => KHO,
  taiTaiLieu: async (t: TaiLieu) => `/tmp/${t.tieuDe}`,
});

describe('tự đính file ở TẦNG LUỒNG — không phụ thuộc model gọi tool', () => {
  it('model trả lời thông số từ lịch sử (0 tool call) → file vẫn được đính', async () => {
    const kq = await chayLenhNhanVien(
      depsCoKho(vi.fn(async () => turnXong('Thông số OVP-K10P: tải 6,55 triệu pixel ạ.'))) as never,
      {
        bizName: 'LEDNELIA',
        conversationId: 'conv-1',
        seq: 0,
        message: { content: '@bot cho tôi thông số kỹ thuật đầu xử lý ovp-k10p', isSelf: true },
      } as never,
    );
    expect(kq.trangThai).toBe('xong');
    expect((kq as { taiLieu?: Array<{ tieuDe: string }> }).taiLieu?.map((t) => t.tieuDe)).toEqual(['K10P.pdf']);
  });

  it('câu KHÔNG phải dạng thông số → không đính gì', async () => {
    const kq = await chayLenhNhanVien(
      depsCoKho(vi.fn(async () => turnXong('Dạ P10 còn 100 tấm ạ.'))) as never,
      {
        bizName: 'LEDNELIA',
        conversationId: 'conv-1',
        seq: 0,
        message: { content: '@bot p10 còn bao nhiêu tấm', isSelf: true },
      } as never,
    );
    expect(kq.trangThai).toBe('xong');
    expect((kq as { taiLieu?: unknown[] }).taiLieu).toBeUndefined();
  });
});
