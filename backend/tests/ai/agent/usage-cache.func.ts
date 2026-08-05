// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: đo được implicit cache — điều kiện để biết tiền LLM đi đâu.
//
// Bối cảnh (kế hoạch #4, 05/08/2026): Gemini implicit caching giảm 60-80% chi
// phí khi prefix ≥1024 token giống hệt giữa các lượt. Nhưng OpenRouter CHỈ trả
// `prompt_tokens_details.cached_tokens` khi request khai `usage.include` —
// thiếu nó thì cache có ăn hay vỡ đều vô hình, không ai biết để sửa.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateWithOpenaiCompatTools } from '../../../src/modules/ai/providers/openai-compat.js';
import type { ToolDefinition } from '../../../src/modules/ai/agent/types.js';

const tools: ToolDefinition[] = [
  { name: 't', description: 'd', inputSchema: { type: 'object', properties: {} } },
];

const THAN = JSON.stringify({
  choices: [{ message: { content: 'xong' }, finish_reason: 'stop' }],
  usage: {
    prompt_tokens: 1500,
    completion_tokens: 20,
    prompt_tokens_details: { cached_tokens: 1200 },
  },
});
const OK = { ok: true, status: 200, json: async () => JSON.parse(THAN), text: async () => THAN };

const goiVoi = (url: string) =>
  generateWithOpenaiCompatTools({
    url, apiKey: 'k', model: 'google/gemini-2.5-flash-lite', system: 'sys',
    messages: [{ role: 'user' as const, content: 'x' }], tools,
  });

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('usage.include — chỉ gửi cho OpenRouter', () => {
  it('URL openrouter → body có usage.include (không có thì cached_tokens không bao giờ về)', async () => {
    const fetchMock = vi.fn(async () => OK);
    vi.stubGlobal('fetch', fetchMock);

    await goiVoi('https://openrouter.ai/api/v1/chat/completions');

    const init = (fetchMock.mock.calls[0] as [string, { body: string }])[1];
    expect(JSON.parse(init.body).usage).toEqual({ include: true });
  });

  it('gateway KHÁC → KHÔNG gửi (OpenAI thật từ chối tham số lạ với 400)', async () => {
    const fetchMock = vi.fn(async () => OK);
    vi.stubGlobal('fetch', fetchMock);

    await goiVoi('https://gw/v1/chat/completions');

    const init = (fetchMock.mock.calls[0] as [string, { body: string }])[1];
    expect(JSON.parse(init.body).usage).toBeUndefined();
  });
});

describe('đọc cached_tokens từ phản hồi', () => {
  it('prompt_tokens_details.cached_tokens → usage.cacheReadTokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => OK));

    const turn = await goiVoi('https://openrouter.ai/api/v1/chat/completions');

    expect(turn.usage).toMatchObject({ inputTokens: 1500, cacheReadTokens: 1200 });
  });
});
