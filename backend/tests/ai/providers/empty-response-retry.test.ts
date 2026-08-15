// SPDX-License-Identifier: AGPL-3.0-or-later
// NHÓM B (15/08) — EMPTY_RESPONSE (học dsh llm/error taxonomy): HTTP 200 mà
// không chữ, không tool call = lượt CÂM. Lần gọi không để lại gì bền → thử
// lại an toàn; hết lượt thử thì trả về như cũ (tầng trên fallback), không ném.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateWithOpenaiCompatTools } from '../../../src/modules/ai/providers/openai-compat.js';

const thanPhanHoi = (content: string | null) => ({
  choices: [{ message: { content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
});
const phanHoi = (content: string | null) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  text: async () => JSON.stringify(thanPhanHoi(content)),
  json: async () => thanPhanHoi(content),
});

afterEach(() => vi.unstubAllGlobals());

describe('EMPTY_RESPONSE → thử lại', () => {
  it('lần 1 rỗng, lần 2 có chữ → trả lần 2; fetch đúng 2 lần', async () => {
    const fetchGia = vi.fn()
      .mockResolvedValueOnce(phanHoi(''))
      .mockResolvedValueOnce(phanHoi('dạ có ạ'));
    vi.stubGlobal('fetch', fetchGia);

    const turn = await generateWithOpenaiCompatTools({
      url: 'https://gw.example/v1/chat/completions', apiKey: 'k', model: 'm',
      system: 's', messages: [{ role: 'user', content: 'còn hàng không' }],
      tools: [], soLanThuLai: 2,
    });

    expect(turn.text).toBe('dạ có ạ');
    expect(fetchGia).toHaveBeenCalledTimes(2);
  });

  it('rỗng tới hết lượt thử → vẫn TRẢ VỀ turn rỗng (không ném vỡ lượt)', async () => {
    const fetchGia = vi.fn().mockResolvedValue(phanHoi(''));
    vi.stubGlobal('fetch', fetchGia);

    const turn = await generateWithOpenaiCompatTools({
      url: 'https://gw.example/v1/chat/completions', apiKey: 'k', model: 'm',
      system: 's', messages: [{ role: 'user', content: 'x' }],
      tools: [], soLanThuLai: 1,
    });

    expect(turn.text ?? '').toBe('');
    expect(fetchGia).toHaveBeenCalledTimes(2); // 1 gọi + 1 thử lại
  });
});
