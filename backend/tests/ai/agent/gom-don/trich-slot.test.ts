// SPDX-License-Identifier: AGPL-3.0-or-later
// Trích slot: LLM bị ép vào MỘT tool ghi_slot; code validate kiểu từng field.
// Model không gọi tool → coi là digression (ngoaiLe) — đường lui an toàn.
import { describe, it, expect } from 'vitest';
import { trichSlot } from '../../../../src/modules/ai/agent/noi-zalo/gom-don/trich-slot.js';
import type { ToolAwareGenerate } from '../../../../src/modules/ai/agent/types.js';

const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

function fakeGenerate(input: Record<string, unknown> | null): { g: ToolAwareGenerate; goi: unknown[] } {
  const goi: unknown[] = [];
  const g: ToolAwareGenerate = async (a) => {
    goi.push(a);
    if (input === null) return { text: 'Dạ em chưa rõ ạ', toolCalls: [], stopReason: 'end_turn', raw: null, usage };
    return {
      text: '', stopReason: 'tool_use', raw: null, usage,
      toolCalls: [{ id: 't1', name: 'ghi_slot', input }],
    };
  };
  return { g, goi };
}

describe('trichSlot', () => {
  it('câu 21:07 07/08 → khach + dong đủ SL; generate nhận đúng 1 tool ghi_slot', async () => {
    const { g, goi } = fakeGenerate({ khach: 'Hưng', dong: [{ sp: 'nguồn NB', sl: 10 }] });
    const kq = await trichSlot(g, 'lên đơn cho anh Hưng 10 cái nguồn NB nhé', null);
    expect(kq).toEqual({ khach: 'Hưng', dong: [{ sp: 'nguồn NB', sl: 10 }] });
    const a = goi[0] as { tools: Array<{ name: string }> };
    expect(a.tools).toHaveLength(1);
    expect(a.tools[0].name).toBe('ghi_slot');
  });

  it('model không gọi tool → ngoaiLe true', async () => {
    const { g } = fakeGenerate(null);
    expect(await trichSlot(g, 'tồn kho NB còn nhiêu?', null)).toEqual({ ngoaiLe: true });
  });

  it('input rác: sl chữ, field lạ → bỏ phần sai, giữ phần đúng', async () => {
    const { g } = fakeGenerate({
      khach: 42, dong: [{ sp: 'nguồn NB', sl: 'mười' }, { sp: 'đèn 50w', sl: 5 }], bay: true,
    });
    expect(await trichSlot(g, 'x', null)).toEqual({
      dong: [{ sp: 'nguồn NB' }, { sp: 'đèn 50w', sl: 5 }],
    });
  });

  it('xacNhan/huy/ngoaiLe truyền qua nguyên vẹn khi đúng kiểu', async () => {
    const { g } = fakeGenerate({ xacNhan: true });
    expect(await trichSlot(g, 'ok chốt đi', null)).toEqual({ xacNhan: true });
    const { g: g2 } = fakeGenerate({ huy: true });
    expect(await trichSlot(g2, 'thôi huỷ đi', null)).toEqual({ huy: true });
  });

  it('có phiên đang mở → prompt chứa ngữ cảnh đã gom (để "10 cái" hiểu là SL bổ sung)', async () => {
    const { g, goi } = fakeGenerate({ dong: [{ sp: 'nguồn NB', sl: 10 }] });
    await trichSlot(g, '10 cái', {
      khachTuKhoa: 'Hưng', dong: [{ tuKhoa: 'nguồn NB', sl: null }],
    });
    const a = goi[0] as { messages: Array<{ content: string }> };
    expect(String(a.messages[0].content)).toContain('nguồn NB');
  });

  it('generate ném lỗi → ngoaiLe true (máy nhường agent thường, không nổ)', async () => {
    const g: ToolAwareGenerate = async () => { throw new Error('timeout'); };
    expect(await trichSlot(g, 'x', null)).toEqual({ ngoaiLe: true });
  });
});

describe('prompt trích slot — tên khách chứa từ ngành hàng', () => {
  // Bug thật 16:15 11/08: "lên đơn cho Anh long led" → model coi "led" là từ
  // ngành hàng, trích khach="Long" → tra sai người cả 2 lượt. Khách buôn ngành
  // đèn tên kiểu "Long Led", "Hùng Đèn" là chuyện thường — prompt phải dặn rõ
  // "bỏ xưng hô" KHÔNG có nghĩa là bỏ biệt danh.
  it('system prompt dặn GIỮ từ ngành hàng trong tên, có ví dụ Long Led', async () => {
    let systemNhan = '';
    const g: ToolAwareGenerate = async (a) => {
      systemNhan = a.system;
      return {
        text: '', stopReason: 'tool_use', raw: null,
        toolCalls: [{ id: 't', name: 'ghi_slot', input: { ngoaiLe: true } }],
      };
    };

    await trichSlot(g, 'lên đơn cho Anh long led nhé', null);

    expect(systemNhan).toContain('Long Led');
    expect(systemNhan.toLowerCase()).toMatch(/giữ nguyên|không bỏ/);
  });
});
