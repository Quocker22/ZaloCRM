// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit test: bộ match guideline — 1 call LLM rẻ trả {stage, matched per-rule}.
//
// Trọng tâm an toàn: MỌI đường lỗi (JSON hỏng, thiếu khoá, stage lạ, timeout)
// đều phải rơi về fallback = nạp TOÀN BỘ guideline — tức hành vi prompt tĩnh
// hôm nay. Không có chế độ nào tệ hơn hiện trạng.
import { describe, it, expect, vi } from 'vitest';
import { matchGuidelines } from '../../../src/modules/ai/agent/guideline-matcher.js';
import type { AgentTurn, ToolAwareGenerate } from '../../../src/modules/ai/agent/types.js';

const GUIDELINES = [
  { id: 'g1', condition: 'khách hỏi shop bán những gì hoặc xin gợi ý chung chung', stage: 'khai_thac' },
  { id: 'g2', condition: 'khách hỏi giá một sản phẩm cụ thể', stage: 'tu_van' },
  { id: 'g7', condition: 'khách đã chốt mua và nói rõ số lượng', stage: 'chot_don' },
];

/** Fake LLM trả đúng một câu text (không tool). */
const traText = (text: string): ToolAwareGenerate =>
  vi.fn(async (): Promise<AgentTurn> => ({
    text, toolCalls: [], stopReason: 'end_turn', raw: [{ type: 'text', text }],
  }));

const input = { message: 'ok lấy 5 cái nhé', history: [] };

describe('matchGuidelines — đường vui', () => {
  it('trả stage + id các rule matched=true từ JSON hợp lệ', async () => {
    const generate = traText(
      '{"stage": "chot_don", "matched": {"g1": false, "g2": false, "g7": true}}',
    );

    const kq = await matchGuidelines({ generate, guidelines: GUIDELINES }, input);

    expect(kq).toEqual({ stage: 'chot_don', matchedIds: ['g7'], fallback: false });
  });

  it('chịu được JSON bọc trong ```json fence (model hay làm vậy)', async () => {
    const generate = traText(
      '```json\n{"stage": "tu_van", "matched": {"g1": false, "g2": true, "g7": false}}\n```',
    );

    const kq = await matchGuidelines({ generate, guidelines: GUIDELINES }, input);

    expect(kq.matchedIds).toEqual(['g2']);
    expect(kq.fallback).toBe(false);
  });

  it('gửi cho LLM đủ điều kiện của TỪNG rule và tin mới nhất', async () => {
    const generate = traText(
      '{"stage": "tu_van", "matched": {"g1": false, "g2": false, "g7": false}}',
    );

    await matchGuidelines({ generate, guidelines: GUIDELINES }, {
      message: 'giá đèn P10 bao nhiêu',
      history: [{ vai: 'khach', noiDung: 'chào shop' }],
    });

    const goiLen = (generate as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      messages: Array<{ content: string }>;
      tools: unknown[];
    };
    const prompt = String(goiLen.messages[0].content);
    for (const g of GUIDELINES) {
      expect(prompt).toContain(g.id);
      expect(prompt).toContain(g.condition);
    }
    expect(prompt).toContain('giá đèn P10 bao nhiêu');
    expect(prompt).toContain('chào shop');
    // Matcher KHÔNG được đăng ký tool nào — nó chỉ phân loại.
    expect(goiLen.tools).toEqual([]);
  });
});

describe('matchGuidelines — mọi đường lỗi rơi về fallback nạp hết', () => {
  const catCaId = GUIDELINES.map((g) => g.id);

  it('JSON hỏng → fallback', async () => {
    const kq = await matchGuidelines(
      { generate: traText('xin lỗi, tôi không chắc'), guidelines: GUIDELINES },
      input,
    );

    expect(kq.fallback).toBe(true);
    expect(kq.matchedIds).toEqual(catCaId);
  });

  it('thiếu khoá một rule trong matched → fallback (model chưa đọc hết)', async () => {
    const kq = await matchGuidelines(
      { generate: traText('{"stage": "tu_van", "matched": {"g1": true}}'), guidelines: GUIDELINES },
      input,
    );

    expect(kq.fallback).toBe(true);
    expect(kq.matchedIds).toEqual(catCaId);
  });

  it('stage lạ ngoài 4 giá trị → fallback', async () => {
    const kq = await matchGuidelines(
      {
        generate: traText(
          '{"stage": "dang_yeu", "matched": {"g1": true, "g2": false, "g7": false}}',
        ),
        guidelines: GUIDELINES,
      },
      input,
    );

    expect(kq.fallback).toBe(true);
  });

  it('LLM ném exception → fallback, KHÔNG ném ra ngoài', async () => {
    const generate: ToolAwareGenerate = vi.fn(async () => {
      throw new Error('mạng đứt');
    });

    const kq = await matchGuidelines({ generate, guidelines: GUIDELINES }, input);

    expect(kq.fallback).toBe(true);
    expect(kq.matchedIds).toEqual(catCaId);
  });

  it('LLM chậm quá timeoutMs → fallback, không chờ mãi', async () => {
    const generate: ToolAwareGenerate = vi.fn(
      () => new Promise((r) => setTimeout(() => r({
        text: '{"stage":"tu_van","matched":{"g1":true,"g2":true,"g7":true}}',
        toolCalls: [], stopReason: 'end_turn', raw: [],
      }), 500)),
    );

    const kq = await matchGuidelines({ generate, guidelines: GUIDELINES, timeoutMs: 50 }, input);

    expect(kq.fallback).toBe(true);
    expect(kq.matchedIds).toEqual(catCaId);
  });
});

