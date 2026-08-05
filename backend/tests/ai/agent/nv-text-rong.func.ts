// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: luồng NHÂN VIÊN phải chặn text rỗng như luồng khách.
//
// Bug thật 05/08/2026 20:57:11 — model gọi tool xong (tra_san_pham →
// tao_don_nhap → gui_hoa_don, tất cả THÀNH CÔNG) rồi trả text RỖNG. Luồng
// nhân viên gửi thẳng chuỗi rỗng cho Zalo:
//
//   ZaloApiError: sendMessage failed: Missing message content
//
// Luồng khách đã có hàng rào này từ sáng cùng ngày; luồng nhân viên thì chưa.
// Tệ hơn: lỗi đó CHE mất việc bot vừa tạo đơn thừa — nhân viên chỉ thấy dòng
// báo lỗi, không biết Odoo đã có thêm một đơn. Nên `lyDo` phải nêu tool GHI.
import { describe, it, expect, vi } from 'vitest';
import { chayLenhNhanVien } from '../../../src/modules/ai/agent/staff-agent.js';
import type { AgentTurn } from '../../../src/modules/ai/agent/types.js';
import type { OdooClient } from '../../../src/modules/ai/odoo/client.js';

const fakeOdoo = () =>
  ({
    searchRead: vi.fn(async (model: string) =>
      model === 'product.product'
        ? [{ id: 5, name: 'Nguồn 12V100W', list_price: 78_000, active: true }]
        : [],
    ),
    execute: vi.fn(async () => 26716),
  }) as unknown as OdooClient;

const luot = (turns: AgentTurn[]) => {
  let i = 0;
  return vi.fn(async () => turns[Math.min(i++, turns.length - 1)]);
};

const goiTool = (name: string, input: Record<string, unknown>): AgentTurn => ({
  text: '',
  toolCalls: [{ id: 't1', name, input }],
  stopReason: 'tool_use',
  raw: [{ type: 'tool_use', id: 't1', name, input }],
});

const ketThuc = (text: string): AgentTurn => ({
  text, toolCalls: [], stopReason: 'end_turn', raw: [{ type: 'text', text }],
});

const chay = (turns: AgentTurn[]) =>
  chayLenhNhanVien(
    { odoo: fakeOdoo(), generate: luot(turns), ghiNhanChuyenSale: vi.fn(async () => {}) },
    {
      bizName: 'LEDNELIA', conversationId: 'conv-rong', seq: 0,
      message: { content: '@bot 10 cái mà', isSelf: true },
    },
  );

describe('text rỗng sau khi gọi tool — luồng nhân viên', () => {
  it('BUG GỐC: gọi tool xong rồi trả rỗng → chua_hoan_tat, KHÔNG phải xong-với-chuỗi-rỗng', async () => {
    const r = await chay([
      goiTool('tao_don_nhap', { khach_hang_id: 1, dong: [{ san_pham_id: 5, so_luong: 10 }] }),
      ketThuc(''),
    ]);

    // Nếu trả 'xong' với traLoi='' thì caller gọi guiTin(dich, '') → Zalo ném.
    expect(r.trangThai).toBe('chua_hoan_tat');
  });

  it('lyDo phải CẢNH BÁO đã ghi vào Odoo — nếu không, đơn thừa nằm im không ai biết', async () => {
    const r = await chay([
      goiTool('tao_don_nhap', { khach_hang_id: 1, dong: [{ san_pham_id: 5, so_luong: 10 }] }),
      ketThuc(''),
    ]);

    if (r.trangThai !== 'chua_hoan_tat') throw new Error('sai nhánh');
    expect(r.lyDo).toContain('tao_don_nhap');
    expect(r.lyDo, 'phải hét lên rằng đã GHI, không chỉ báo lỗi chung chung').toContain('GHI');
  });

  it('text chỉ có khoảng trắng cũng là rỗng — Zalo từ chối y hệt', async () => {
    const r = await chay([ketThuc('   \n  ')]);

    expect(r.trangThai).toBe('chua_hoan_tat');
  });

  it('KHÔNG hồi quy: có text thật thì vẫn xong bình thường', async () => {
    const r = await chay([
      goiTool('tra_san_pham', { ten: 'nguồn' }),
      ketThuc('Nguồn 12V100W giá 78.000đ ạ'),
    ]);

    expect(r.trangThai).toBe('xong');
    if (r.trangThai !== 'xong') return;
    expect(r.traLoi).toBe('Nguồn 12V100W giá 78.000đ ạ');
  });

  it('tool chỉ ĐỌC mà text rỗng → vẫn chặn, nhưng KHÔNG cảnh báo ghi Odoo', async () => {
    const r = await chay([goiTool('tra_san_pham', { ten: 'nguồn' }), ketThuc('')]);

    if (r.trangThai !== 'chua_hoan_tat') throw new Error('sai nhánh');
    expect(r.lyDo).toContain('tra_san_pham');
    expect(r.lyDo).not.toContain('GHI');
  });
});
