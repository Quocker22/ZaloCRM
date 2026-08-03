// SPDX-License-Identifier: AGPL-3.0-or-later
// Test adapter Anthropic tool-calling: dịch wire format đúng cả 2 chiều.
// Mock fetch để không gọi API thật.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateWithAnthropicTools } from '../../../src/modules/ai/providers/anthropic.js';
import type { ToolDefinition } from '../../../src/modules/ai/agent/types.js';

const tools: ToolDefinition[] = [
  {
    name: 'tra_gia',
    description: 'Tra giá SP',
    inputSchema: { type: 'object', properties: { ten: { type: 'string' } }, required: ['ten'] },
  },
];

const baseArgs = {
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'sk-test',
  model: 'claude-opus-5',
  system: 'Bạn là trợ lý',
  tools,
};

function mockFetch(body: unknown, ok = true, status = 200) {
  const fn = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Lấy body JSON đã gửi lên trong lần fetch đầu tiên. */
const sentBody = (fn: ReturnType<typeof mockFetch>) =>
  JSON.parse((fn.mock.calls[0][1] as { body: string }).body);

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('generateWithAnthropicTools — đọc response', () => {
  it('response chỉ có text → stopReason end_turn, không tool call', async () => {
    mockFetch({ content: [{ type: 'text', text: 'Dạ shop mở 9h-22h' }], stop_reason: 'end_turn' });

    const turn = await generateWithAnthropicTools({
      ...baseArgs,
      messages: [{ role: 'user', content: 'mấy giờ mở?' }],
    });

    expect(turn.text).toBe('Dạ shop mở 9h-22h');
    expect(turn.toolCalls).toHaveLength(0);
    expect(turn.stopReason).toBe('end_turn');
  });

  it('response có tool_use → trích đúng id/name/input', async () => {
    mockFetch({
      content: [
        { type: 'text', text: 'Để em tra giá' },
        { type: 'tool_use', id: 'toolu_01', name: 'tra_gia', input: { ten: 'P10' } },
      ],
      stop_reason: 'tool_use',
    });

    const turn = await generateWithAnthropicTools({
      ...baseArgs,
      messages: [{ role: 'user', content: 'P10 giá bao nhiêu?' }],
    });

    expect(turn.stopReason).toBe('tool_use');
    expect(turn.toolCalls).toEqual([{ id: 'toolu_01', name: 'tra_gia', input: { ten: 'P10' } }]);
    expect(turn.text).toBe('Để em tra giá');
  });

  it('giữ NGUYÊN VẸN content thô trong raw (vòng lặp phải đẩy lại y hệt)', async () => {
    const blocks = [{ type: 'tool_use', id: 'toolu_01', name: 'tra_gia', input: { ten: 'P10' } }];
    mockFetch({ content: blocks, stop_reason: 'tool_use' });

    const turn = await generateWithAnthropicTools({
      ...baseArgs,
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(turn.raw).toEqual(blocks);
  });

  it('nhiều tool_use trong 1 response → trích hết (tool song song)', async () => {
    mockFetch({
      content: [
        { type: 'tool_use', id: 'a', name: 'tra_gia', input: { ten: 'P10' } },
        { type: 'tool_use', id: 'b', name: 'tra_gia', input: { ten: 'P4' } },
      ],
      stop_reason: 'tool_use',
    });

    const turn = await generateWithAnthropicTools({
      ...baseArgs,
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(turn.toolCalls).toHaveLength(2);
  });

  it('nhiều block text → nối lại thành một chuỗi', async () => {
    mockFetch({
      content: [{ type: 'text', text: 'Dạ ' }, { type: 'text', text: 'em nghe ạ' }],
      stop_reason: 'end_turn',
    });

    const turn = await generateWithAnthropicTools({
      ...baseArgs,
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(turn.text).toBe('Dạ em nghe ạ');
  });

  it('max_tokens → map đúng (tầng gọi phải biết câu bị cắt)', async () => {
    mockFetch({ content: [{ type: 'text', text: 'Dạ giá là' }], stop_reason: 'max_tokens' });

    const turn = await generateWithAnthropicTools({
      ...baseArgs,
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(turn.stopReason).toBe('max_tokens');
  });

  it('response rỗng → text rỗng, KHÔNG ném (khác hàm text-only cũ)', async () => {
    // Vòng lặp cần AgentTurn để quyết định, không cần exception.
    mockFetch({ content: [], stop_reason: 'end_turn' });

    const turn = await generateWithAnthropicTools({
      ...baseArgs,
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(turn.text).toBe('');
    expect(turn.toolCalls).toHaveLength(0);
  });
});

describe('generateWithAnthropicTools — gửi request', () => {
  it('gửi tools đúng format input_schema của Anthropic', async () => {
    const fn = mockFetch({ content: [], stop_reason: 'end_turn' });

    // cache: false để kiểm riêng phần format, không lẫn cache_control.
    await generateWithAnthropicTools({
      ...baseArgs,
      messages: [{ role: 'user', content: 'x' }],
      cache: false,
    });

    expect(sentBody(fn).tools).toEqual([
      {
        name: 'tra_gia',
        description: 'Tra giá SP',
        input_schema: { type: 'object', properties: { ten: { type: 'string' } }, required: ['ten'] },
      },
    ]);
  });

  it('ToolResult → tool_result block đúng chuẩn Anthropic', async () => {
    const fn = mockFetch({ content: [], stop_reason: 'end_turn' });

    await generateWithAnthropicTools({
      ...baseArgs,
      cache: false,
      messages: [
        { role: 'user', content: 'P10 giá bao nhiêu?' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_01' }] },
        { role: 'user', content: [{ toolCallId: 'toolu_01', content: '120000' }] },
      ],
    });

    expect(sentBody(fn).messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'toolu_01', content: '120000' },
    ]);
  });

  it('ToolResult lỗi → kèm is_error: true', async () => {
    const fn = mockFetch({ content: [], stop_reason: 'end_turn' });

    await generateWithAnthropicTools({
      ...baseArgs,
      messages: [
        { role: 'user', content: 'x' },
        { role: 'user', content: [{ toolCallId: 't1', content: 'Odoo lỗi', isError: true }] },
      ],
    });

    expect(sentBody(fn).messages[1].content[0]).toMatchObject({
      type: 'tool_result',
      is_error: true,
    });
  });

  it('content block thô của assistant đi qua NGUYÊN VẸN', async () => {
    const fn = mockFetch({ content: [], stop_reason: 'end_turn' });
    const raw = [{ type: 'tool_use', id: 'toolu_01', name: 'tra_gia', input: { ten: 'P10' } }];

    await generateWithAnthropicTools({
      ...baseArgs,
      cache: false,
      messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: raw }],
    });

    expect(sentBody(fn).messages[1].content).toEqual(raw);
  });

  it('HTTP lỗi → ném kèm status (provider hỏng thì không lặp tiếp được)', async () => {
    mockFetch({ error: 'invalid key' }, false, 401);

    await expect(
      generateWithAnthropicTools({ ...baseArgs, messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toThrow(/401/);
  });
});

describe('prompt caching', () => {
  const goi = async (over: Record<string, unknown> = {}) => {
    const fn = mockFetch({ content: [], stop_reason: 'end_turn' });
    await generateWithAnthropicTools({
      ...baseArgs,
      messages: [{ role: 'user', content: 'x' }],
      ...over,
    });
    return sentBody(fn);
  };

  it('BẬT mặc định (không phải opt-in)', async () => {
    const b = await goi();
    expect(b.tools[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('cache_control đặt ở TOOL CUỐI → cache toàn bộ mảng tools', async () => {
    const nhieuTool = [
      { ...tools[0], name: 'a' },
      { ...tools[0], name: 'b' },
      { ...tools[0], name: 'c' },
    ];
    const b = await goi({ tools: nhieuTool });

    expect(b.tools[0].cache_control).toBeUndefined();
    expect(b.tools[1].cache_control).toBeUndefined();
    expect(b.tools[2].cache_control).toEqual({ type: 'ephemeral' }); // chỉ tool cuối
  });

  it('system thành mảng block có cache_control (breakpoint 2)', async () => {
    const b = await goi();
    expect(b.system).toEqual([
      { type: 'text', text: 'Bạn là trợ lý', cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('breakpoint 3 ở MESSAGE CUỐI — chống bẫy 20-block lookback', async () => {
    // Vòng lặp 8 vòng sinh ~16-24 content block, vượt tầm quét 20 block của cache.
    // Breakpoint trôi theo message cuối thì lượt sau luôn tìm thấy cache lượt trước.
    const b = await goi({
      messages: [
        { role: 'user', content: 'câu hỏi' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1' }] },
        { role: 'user', content: [{ toolCallId: 't1', content: 'kết quả' }] },
      ],
    });

    expect(b.messages[0].content).toBe('câu hỏi');           // không đánh dấu
    expect(b.messages[1].content[0].cache_control).toBeUndefined();
    expect(b.messages[2].content[0].cache_control).toEqual({ type: 'ephemeral' }); // cuối
  });

  it('cache: false → KHÔNG có cache_control ở bất kỳ đâu', async () => {
    const b = await goi({ cache: false });

    expect(JSON.stringify(b)).not.toContain('cache_control');
    expect(b.system).toBe('Bạn là trợ lý'); // giữ dạng chuỗi
  });
});

describe('context editing', () => {
  const cfg = {
    edits: [
      {
        type: 'clear_tool_uses_20250919' as const,
        trigger: { type: 'input_tokens' as const, value: 30_000 },
        keep: { type: 'tool_uses' as const, value: 3 },
        exclude_tools: ['tao_don_nhap'],
      },
    ],
  };

  it('gửi context_management + beta header khi có cấu hình', async () => {
    const fn = mockFetch({ content: [], stop_reason: 'end_turn' });

    await generateWithAnthropicTools({
      ...baseArgs,
      messages: [{ role: 'user', content: 'x' }],
      contextManagement: cfg,
    });

    const headers = (fn.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(headers['anthropic-beta']).toBe('context-management-2025-06-27');
    expect(sentBody(fn).context_management).toEqual(cfg);
  });

  it('KHÔNG gửi beta header khi không dùng (tránh bật beta thừa)', async () => {
    const fn = mockFetch({ content: [], stop_reason: 'end_turn' });

    await generateWithAnthropicTools({ ...baseArgs, messages: [{ role: 'user', content: 'x' }] });

    const headers = (fn.mock.calls[0][1] as { headers: Record<string, string> }).headers;
    expect(headers['anthropic-beta']).toBeUndefined();
    expect(sentBody(fn).context_management).toBeUndefined();
  });
});

describe('usage — đo hiệu quả cache', () => {
  it('trích đủ 4 số từ response', async () => {
    mockFetch({
      content: [],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 50,
        output_tokens: 20,
        cache_read_input_tokens: 1087,
        cache_creation_input_tokens: 0,
      },
    });

    const turn = await generateWithAnthropicTools({
      ...baseArgs,
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(turn.usage).toEqual({
      inputTokens: 50,
      outputTokens: 20,
      cacheReadTokens: 1087,
      cacheWriteTokens: 0,
    });
  });

  it('provider không trả usage → undefined, KHÔNG sập', async () => {
    mockFetch({ content: [], stop_reason: 'end_turn' });

    const turn = await generateWithAnthropicTools({
      ...baseArgs,
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(turn.usage).toBeUndefined();
  });
});
