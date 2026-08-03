// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Nguyễn Tiến Lộc
/**
 * Shared handler for OpenAI-compatible chat/completions API.
 * Works with: OpenAI, Qwen (dashscope compat mode), Kimi (Moonshot), 9router gateway.
 */
import type {
  AgentMessage,
  AgentTurn,
  ToolDefinition,
  ToolResult,
} from '../agent/types.js';
export async function generateWithOpenaiCompat(
  url: string,
  apiKey: string,
  model: string,
  system: string,
  prompt: string,
  maxTokens = 600,
  // OpenAI thế hệ mới (gpt-5.x / o-series) bỏ `max_tokens`, đòi `max_completion_tokens`.
  // Qwen/Kimi (compat mode cũ) vẫn dùng `max_tokens` → cho phép caller chọn tên tham số.
  tokenParam: 'max_tokens' | 'max_completion_tokens' = 'max_tokens',
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        [tokenParam]: maxTokens,
        // stream:false rõ ràng — một số gateway (vd 9router) MẶC ĐỊNH trả SSE
        // (`data: {...}`) khi thiếu field này, làm response.json() crash.
        stream: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const status = response.status;
      throw new Error(`OpenAI-compat request failed with status ${status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = boSuyNghi(data.choices?.[0]?.message?.content ?? '');
    if (!text) throw new Error('OpenAI-compat returned empty content');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------------ */
/* Tool-calling qua OpenAI-compatible API (dùng cho 9router, OpenAI, Qwen…)  */
/* ------------------------------------------------------------------------ */

interface OpenAIToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

/**
 * Bỏ khối suy nghĩ của model *reasoning* trước khi trả cho người dùng.
 *
 * Đo thật 2026-08-03: `qwen3:8b` qua Ollama trả nguyên `<think>Okay, let's see.
 * The user wants me to…</think>` trong `message.content`, và cầu nối Zalo gửi
 * thẳng khối đó cho khách. Gateway 9router (gemini-3-flash) không sinh thẻ này
 * nên bug nằm im — nhưng bất kỳ model reasoning nào cũng làm lộ.
 *
 * Cắt ở TẦNG PROVIDER để cả luồng khách lẫn nhân viên đều được che, thay vì
 * nhớ lọc ở từng nơi hiển thị.
 *
 * Thẻ MỞ mà không có thẻ đóng nghĩa là model bị cắt giữa chừng: bỏ toàn bộ
 * phần còn lại, vì đó vẫn là suy nghĩ chứ chưa phải câu trả lời.
 */
export function boSuyNghi(raw: string): string {
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/i, '')
    .trim();
}

/** Map finish_reason của OpenAI sang kiểu trung lập của vòng lặp. */
function mapFinishReason(raw: string | undefined): AgentTurn['stopReason'] {
  if (raw === 'tool_calls' || raw === 'function_call') return 'tool_use';
  if (raw === 'stop') return 'end_turn';
  if (raw === 'length') return 'max_tokens';
  return 'other';
}

/**
 * Đổi message trung lập sang wire format OpenAI.
 *
 * Khác Anthropic ở chỗ QUAN TRỌNG: OpenAI đặt mỗi tool result thành MỘT message
 * riêng với `role: 'tool'`, không gộp vào một message user. Ngược hẳn với Anthropic.
 * Đây là nguồn lỗi hay gặp khi port code giữa hai provider.
 */
function toOpenAIMessages(system: string, messages: AgentMessage[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }];

  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }

    const blocks = m.content as unknown[];

    if (m.role === 'assistant') {
      // Content thô của assistant: ta lưu nguyên mảng tool_calls kiểu OpenAI.
      const toolCalls = blocks.filter(
        (b) => (b as OpenAIToolCall).type === 'function',
      );
      const text = blocks
        .filter((b) => (b as { type?: string }).type === 'text')
        .map((b) => (b as { text?: string }).text ?? '')
        .join('');
      out.push({
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    // role 'user' chứa ToolResult → tách thành nhiều message role:'tool'.
    for (const block of blocks) {
      const r = block as Partial<ToolResult>;
      if (typeof r.toolCallId === 'string') {
        out.push({
          role: 'tool',
          tool_call_id: r.toolCallId,
          // OpenAI không có cờ is_error → nhét vào nội dung để model vẫn biết.
          content: r.isError ? `LỖI: ${r.content ?? ''}` : (r.content ?? ''),
        });
      } else {
        out.push({ role: 'user', content: JSON.stringify(block) });
      }
    }
  }
  return out;
}

/**
 * Gọi API OpenAI-compatible có kèm tools, trả về 1 lượt (AgentTurn).
 *
 * KHÔNG tự chạy vòng lặp — vòng lặp là việc của agent/loop.ts.
 *
 * Lưu ý về prompt caching: OpenAI/9router KHÔNG có `cache_control` như Anthropic.
 * OpenAI tự động cache prefix ≥1024 token (không cần khai báo, giảm 50% chứ không
 * phải 90%). Nên hàm này không nhận tham số cache.
 */
/** Chờ (ms). */
const nghi = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Lỗi có nên thử lại không.
 *
 * Gateway (9router, proxy…) hay ngắt kết nối khi bị gọi dồn — biểu hiện là
 * `fetch failed` hoặc 429/5xx. Đây là lỗi TẠM THỜI: thử lại sau vài trăm ms
 * là qua. Không retry thì nhân viên thấy bot "chết" giữa chừng.
 *
 * KHÔNG retry 4xx khác (400 sai tham số, 401 sai key) — thử lại vô nghĩa.
 */
function nenThuLai(err: unknown, status?: number): boolean {
  if (status !== undefined) return status === 429 || status >= 500;

  // Timeout của ta (AbortController) — err.name = 'AbortError', message có thể
  // là "This operation was aborted" nên PHẢI check theo name, không chỉ message.
  if (err instanceof Error && err.name === 'AbortError') return true;

  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('socket') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('aborted')
  );
}

export async function generateWithOpenaiCompatTools(args: {
  url: string;
  apiKey: string;
  model: string;
  system: string;
  messages: AgentMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
  tokenParam?: 'max_tokens' | 'max_completion_tokens';
  timeoutMs?: number;
  /**
   * Số lần thử lại khi gateway chập chờn. Mặc định 3 (tổng 4 lần gọi).
   *
   * Đo thực tế: chạy 100 ca với 2 lần thử lại vẫn còn 8 ca hỏng — và cả 8 đều
   * rơi vào đầu phiên, khi gateway chưa "ấm". Backoff 1s → 2s → 4s phủ được
   * khoảng đó; nhân viên chờ thêm vài giây vẫn hơn nhận lỗi.
   */
  soLanThuLai?: number;
}): Promise<AgentTurn> {
  const tokenParam = args.tokenParam ?? 'max_tokens';
  const toiDa = args.soLanThuLai ?? 3;

  const body = JSON.stringify({
    model: args.model,
    messages: toOpenAIMessages(args.system, args.messages),
    tools: args.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    })),
    [tokenParam]: args.maxTokens ?? 4096,
    // BẮT BUỘC: 9router mặc định trả SSE khi thiếu field này → .json() crash.
    stream: false,
  });

  let loiCuoi: unknown;

  for (let lan = 0; lan <= toiDa; lan += 1) {
    if (lan > 0) {
      // Backoff luỹ tiến 1s → 2s → 4s + jitter.
      // Jitter quan trọng khi nhiều lượt chạy song song: không có nó thì tất cả
      // cùng thử lại một thời điểm và lại bị chặn tiếp.
      await nghi(1000 * 2 ** (lan - 1) + Math.floor(Math.random() * 500));
    }

    const controller = new AbortController();
    // Timeout NGẮN DẦN theo số lần thử: 12s → 20s → 30s → 40s.
    //
    // Vì sao không để cố định: đo thực tế 120 ca, lượt bình thường 3-8s. Gateway
    // kẹt quá 12s gần như chắc chắn hỏng — cắt sớm rồi thử lại nhanh hơn nhiều so
    // với chờ hết 25s. Nhưng lần thử sau phải nới rộng, phòng khi mạng thật sự chậm.
    const hanCho = args.timeoutMs ?? [12_000, 20_000, 30_000, 40_000][Math.min(lan, 3)];
    const timeout = setTimeout(() => controller.abort(), hanCho);

    try {
      const response = await fetch(args.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${args.apiKey}`,
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const err = new Error(`OpenAI-compat tool request failed (${response.status}): ${text}`);
        if (lan < toiDa && nenThuLai(err, response.status)) {
          loiCuoi = err;
          continue;
        }
        throw err;
      }

      return docPhanHoi(await response.json());
    } catch (err) {
      loiCuoi = err;
      if (lan < toiDa && nenThuLai(err)) continue;
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw loiCuoi instanceof Error ? loiCuoi : new Error(String(loiCuoi));
}

/** Đọc response OpenAI-compat thành AgentTurn. Tách riêng cho vòng retry gọn. */
function docPhanHoi(raw: unknown): AgentTurn {
  const data = raw as {
    choices?: Array<{
      message?: { content?: string; tool_calls?: OpenAIToolCall[] };
      finish_reason?: string;
    }>;
    usage?: Record<string, unknown>;
  };

  const choice = data.choices?.[0];
  const rawCalls = choice?.message?.tool_calls ?? [];

  const toolCalls = rawCalls.map((c) => {
    let input: Record<string, unknown> = {};
    try {
      // arguments là CHUỖI JSON (khác Anthropic trả object sẵn).
      input = JSON.parse(c.function?.arguments || '{}');
    } catch {
      // JSON hỏng → để rỗng; registry sẽ báo lỗi tham số và model tự sửa.
    }
    return { id: c.id ?? '', name: c.function?.name ?? '', input };
  });

  // Một số gateway trả tool_calls nhưng finish_reason='stop' → suy từ dữ liệu thật.
  const stopReason: AgentTurn['stopReason'] =
    toolCalls.length > 0 ? 'tool_use' : mapFinishReason(choice?.finish_reason);

  const usageRaw = data.usage;
  return {
    text: boSuyNghi(choice?.message?.content ?? ''),
    toolCalls,
    stopReason,
    // Giữ nguyên tool_calls kiểu OpenAI để đẩy lại đúng format ở lượt sau.
    raw: rawCalls.length > 0
      ? rawCalls
      : [{ type: 'text', text: boSuyNghi(choice?.message?.content ?? '') }],
    usage: usageRaw
      ? {
          inputTokens: Number(usageRaw.prompt_tokens ?? 0),
          outputTokens: Number(usageRaw.completion_tokens ?? 0),
          // OpenAI báo cache qua prompt_tokens_details.cached_tokens (nếu có).
          cacheReadTokens: Number(
            (usageRaw.prompt_tokens_details as Record<string, unknown> | undefined)
              ?.cached_tokens ?? 0,
          ),
          cacheWriteTokens: 0, // OpenAI không tính riêng cache write
        }
      : undefined,
  };
}
