// SPDX-License-Identifier: AGPL-3.0-or-later
// Tham số gửi OpenRouter cho lượt harness (27/08): reasoning chỉ bật khi
// suyNghi=true (effort low), tool_choice=required chỉ khi epTool=true.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateWithOpenaiCompatTools } from '../../../src/modules/ai/providers/openai-compat.js';

const TOOL = { name: 'phan_quyet', description: 'x', inputSchema: { type: 'object', properties: {} } };
function fetchGia() {
  const bodies: Array<Record<string, unknown>> = [];
  const f = vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', f);
  return bodies;
}
afterEach(() => vi.unstubAllGlobals());

describe('generateWithOpenaiCompatTools — reasoning / tool_choice', () => {
  it('deepseek qua OpenRouter: mặc định reasoning TẮT, không tool_choice', async () => {
    const bodies = fetchGia();
    await generateWithOpenaiCompatTools({ url: 'https://openrouter.ai/api/v1/chat/completions', apiKey: 'k', model: 'deepseek/deepseek-v4-flash', system: 's', messages: [{ role: 'user', content: 'u' }], tools: [TOOL], soLanThuLai: 0 });
    expect(bodies[0].reasoning).toEqual({ enabled: false });
    expect(bodies[0]).not.toHaveProperty('tool_choice');
  });
  it('suyNghi=true → reasoning bật effort low; epTool=true → tool_choice=required', async () => {
    const bodies = fetchGia();
    await generateWithOpenaiCompatTools({ url: 'https://openrouter.ai/api/v1/chat/completions', apiKey: 'k', model: 'deepseek/deepseek-v4-flash', system: 's', messages: [{ role: 'user', content: 'u' }], tools: [TOOL], soLanThuLai: 0, suyNghi: true, epTool: true });
    expect(bodies[0].reasoning).toEqual({ enabled: true, effort: 'low' });
    expect(bodies[0].tool_choice).toBe('required');
  });
  it('gateway KHÔNG phải OpenRouter → không gửi reasoning lẫn tool_choice (tránh 400 tham số lạ)', async () => {
    const bodies = fetchGia();
    await generateWithOpenaiCompatTools({ url: 'https://9router.local/v1/chat/completions', apiKey: 'k', model: 'deepseek/deepseek-v4-flash', system: 's', messages: [{ role: 'user', content: 'u' }], tools: [TOOL], soLanThuLai: 0, suyNghi: true, epTool: true });
    expect(bodies[0]).not.toHaveProperty('reasoning');
    expect(bodies[0]).not.toHaveProperty('tool_choice');
  });
});
