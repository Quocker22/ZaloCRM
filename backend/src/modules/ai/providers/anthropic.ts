// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
import type {
  AgentMessage,
  AgentTurn,
  ContextManagementConfig,
  ToolDefinition,
  ToolResult,
} from '../agent/types.js';

export async function generateWithAnthropic(baseUrl: string, apiKey: string, model: string, system: string, prompt: string, maxTokens = 600) {
  const url = `${baseUrl}/v1/messages`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        authorization: `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Anthropic request failed (${response.status}): ${body}`);
    }

    const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((item) => item.type === 'text')?.text?.trim();
    if (!text) throw new Error('Anthropic returned empty content');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------------ */
/* Tool-calling (2026-07) — hàm RIÊNG, không đụng generateWithAnthropic ở trên. */
/* ------------------------------------------------------------------------ */

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/** Map stop_reason của Anthropic sang kiểu trung lập của vòng lặp. */
function mapStopReason(raw: string | undefined): AgentTurn['stopReason'] {
  if (raw === 'tool_use') return 'tool_use';
  if (raw === 'end_turn' || raw === 'stop_sequence') return 'end_turn';
  if (raw === 'max_tokens') return 'max_tokens';
  return 'other';
}

/**
 * Đổi message trung lập sang wire format của Anthropic.
 * Mảng ToolResult → mảng content block `tool_result`.
 *
 * @param cache đặt cache_control lên block CUỐI CÙNG của message cuối.
 *
 * Vì sao cần breakpoint ở messages (không chỉ tools + system): cache lookback chỉ
 * quét ngược tối đa 20 content block. Vòng lặp 8 vòng sinh ~16-24 block, vượt ngưỡng
 * đó → mất cache phần lịch sử. Đặt breakpoint trôi theo message cuối thì lượt sau
 * luôn tìm thấy cache của lượt trước trong tầm quét.
 */
function toAnthropicMessages(messages: AgentMessage[], cache = false): unknown[] {
  const cuoi = messages.length - 1;

  return messages.map((m, i) => {
    const danhDau = cache && i === cuoi;

    if (typeof m.content === 'string') {
      // Chuỗi thuần: phải đổi sang mảng block mới gắn được cache_control.
      return danhDau
        ? {
            role: m.role,
            content: [
              { type: 'text', text: m.content, cache_control: { type: 'ephemeral' } },
            ],
          }
        : { role: m.role, content: m.content };
    }

    const goc = m.content as unknown[];
    const blocks = goc.map((block, j) => {
      const cuoiCung = danhDau && j === goc.length - 1;

      // ToolResult của ta → tool_result block của Anthropic.
      const maybe = block as Partial<ToolResult>;
      if (typeof maybe.toolCallId === 'string') {
        return {
          type: 'tool_result',
          tool_use_id: maybe.toolCallId,
          content: maybe.content ?? '',
          ...(maybe.isError ? { is_error: true } : {}),
          ...(cuoiCung ? { cache_control: { type: 'ephemeral' } } : {}),
        };
      }
      // Content block thô của assistant — trả nguyên vẹn (thêm cache nếu là block cuối).
      return cuoiCung
        ? { ...(block as Record<string, unknown>), cache_control: { type: 'ephemeral' } }
        : block;
    });
    return { role: m.role, content: blocks };
  });
}

/**
 * Gọi Anthropic Messages API có kèm tools, trả về 1 lượt (AgentTurn).
 *
 * KHÔNG tự chạy vòng lặp — vòng lặp là việc của agent/loop.ts. Hàm này chỉ lo
 * đúng một lượt request/response và dịch wire format.
 */
export async function generateWithAnthropicTools(args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Bật prompt caching cho phần TĨNH (tools + system). Mặc định BẬT.
   *
   * Cache read chỉ tốn 0,1× giá gốc → tiết kiệm ~92% mỗi lần trúng. Với vòng lặp
   * agentic, tools + system lặp lại y hệt mỗi vòng nên đây là chỗ tiết kiệm dễ nhất.
   *
   * Điều kiện đã thoả sẵn trong code này: definitions() sort theo tên (thứ tự tool
   * ổn định) và system prompt không nội suy timestamp. Đổi một trong hai là mất cache.
   */
  cache?: boolean;
  /** Cấu hình context editing (xoá tool result cũ). Bỏ trống = tắt. */
  contextManagement?: ContextManagementConfig;
}): Promise<AgentTurn> {
  const url = `${args.baseUrl}/v1/messages`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 60_000);
  const dungCache = args.cache !== false;

  // cache_control đặt ở TOOL CUỐI → cache toàn bộ mảng tools (render vị trí 0).
  const tools = args.tools.map((t, i) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
    ...(dungCache && i === args.tools.length - 1
      ? { cache_control: { type: 'ephemeral' as const } }
      : {}),
  }));

  // system dạng mảng block để gắn được cache_control. Breakpoint thứ 2 (sau tools).
  const system = dungCache
    ? [{ type: 'text' as const, text: args.system, cache_control: { type: 'ephemeral' as const } }]
    : args.system;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': args.apiKey,
        authorization: `Bearer ${args.apiKey}`,
        'anthropic-version': '2023-06-01',
        ...(args.contextManagement
          ? { 'anthropic-beta': 'context-management-2025-06-27' }
          : {}),
      },
      body: JSON.stringify({
        model: args.model,
        max_tokens: args.maxTokens ?? 4096,
        system,
        messages: toAnthropicMessages(args.messages, dungCache),
        tools,
        ...(args.contextManagement ? { context_management: args.contextManagement } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Anthropic request failed (${response.status}): ${body}`);
    }

    const data = await response.json() as {
      content?: AnthropicContentBlock[];
      stop_reason?: string;
      usage?: Record<string, unknown>;
    };
    const blocks = data.content ?? [];

    return {
      text: blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim(),
      toolCalls: blocks
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id ?? '', name: b.name ?? '', input: b.input ?? {} })),
      stopReason: mapStopReason(data.stop_reason),
      // Giữ nguyên content thô — vòng lặp phải đẩy lại y hệt ở lượt sau.
      raw: blocks,
      usage: data.usage
        ? {
            inputTokens: Number(data.usage.input_tokens ?? 0),
            outputTokens: Number(data.usage.output_tokens ?? 0),
            cacheReadTokens: Number(data.usage.cache_read_input_tokens ?? 0),
            cacheWriteTokens: Number(data.usage.cache_creation_input_tokens ?? 0),
          }
        : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}
