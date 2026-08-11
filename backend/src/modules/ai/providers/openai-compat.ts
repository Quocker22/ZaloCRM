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

    const data = (await docJson(response)) as {
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
 * Đọc JSON từ phản hồi, chịu được rác ở đầu thân.
 *
 * Bug thật 2026-08-05: OpenRouter trả `"\n         \n{...}"` — khoảng trắng và
 * xuống dòng TRƯỚC dấu `{`. `response.json()` của Node ném ngay, agent chết ở
 * lượt LLM đầu tiên và bot im lặng hoàn toàn (log chỉ có "BẮT ĐẦU xử lý" rồi
 * không gì nữa).
 *
 * Cắt tới ký tự `{` hoặc `[` đầu tiên rồi mới phân tích. Thân không có JSON nào
 * thì ném kèm 200 ký tự đầu — để lần sau đọc log là biết ngay, khỏi đoán.
 */
export async function docJson(response: Response): Promise<unknown> {
  const raw = await response.text();
  const dau = raw.search(/[{[]/);
  if (dau < 0) {
    throw new Error(`Phản hồi không phải JSON: ${JSON.stringify(raw.slice(0, 200))}`);
  }
  try {
    return JSON.parse(raw.slice(dau));
  } catch (err) {
    throw new Error(
      `JSON hỏng (${err instanceof Error ? err.message.slice(0, 60) : 'lỗi'}): ` +
      JSON.stringify(raw.slice(dau, dau + 200)),
    );
  }
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
/**
 * Model có chế độ thinking/reasoning — nhận diện theo tên để trói effort.
 * Danh sách mở rộng dần khi đổi model; nhận nhầm model thường thành thinking
 * thì OpenRouter chỉ lặng lẽ bỏ qua tham số, vô hại.
 */
export function laModelThinking(model: string): boolean {
  return /deepseek|think|reason|-r1\b|qwq|o[134](?:-mini)?/i.test(model);
}

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
  /**
   * MỐC hết hạn tuyệt đối (Date.now() + ngân sách) của cả lượt agent.
   *
   * Bug thật lặp đi lặp lại (chẩn đoán 11/08): hạn tổng của lượt là 90s, nhưng
   * riêng vòng lặp thử-lại ở đây được phép chạy 12+20+30+40s cộng nghỉ
   * 1+2+4s = 109s. Một mắt xích dài hơn cả sợi dây → chỉ cần gateway chậm MỘT
   * lần trong 8 vòng agent là cả lượt chết, bất kể nhân viên hỏi gì.
   *
   * Có mốc này thì mỗi lần gọi chỉ được chờ trong phần CÒN LẠI, và hết ngân
   * sách thì dừng thử lại luôn thay vì chờ vô ích rồi bị tầng trên cắt.
   */
  hanChotMs?: number;
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
    // OpenRouter chỉ trả `prompt_tokens_details.cached_tokens` khi request khai
    // `usage.include` — thiếu nó thì KHÔNG BAO GIỜ biết implicit cache của
    // Gemini có ăn không (prefix ≥1024 token giống hệt → đọc giá 0,25×).
    // Chỉ gửi cho OpenRouter: OpenAI thật từ chối tham số lạ (400).
    ...(args.url.includes('openrouter') ? { usage: { include: true } } : {}),
    // MODEL THINKING phải bị TẮT reasoning trong vòng lặp tool.
    //
    // Đo thật trên chính key prod (18:50 08/08), câu "chào shop":
    //   mặc định   13,6s · 643 token suy nghĩ
    //   effort low  9,4s · 237 token   ← fix 16:53 chỉ giảm 30%, KHÔNG đủ
    //   tắt hẳn     1,3s ·   0 token   ← câu trả lời vẫn đúng vai, lịch sự
    // Một lượt tư vấn 2 tool vì thế mất 57s (bug thật 18:41): khách chờ gần
    // một phút, tin sau bị guard "có tin mới hơn" nuốt nên bot như câm.
    //
    // Chọn tool + soạn câu bán hàng KHÔNG cần suy luận sâu — quy trình đã do
    // máy trạng thái cầm lái. Cần nghĩ sâu ở đâu thì bật riêng chỗ đó.
    // Chỉ gửi cho OpenRouter — gateway khác có thể 400 với tham số lạ.
    ...(args.url.includes('openrouter') && laModelThinking(args.model)
      ? { reasoning: { enabled: false } }
      : {}),
  });

  let loiCuoi: unknown;

  for (let lan = 0; lan <= toiDa; lan += 1) {
    if (lan > 0) {
      // Backoff luỹ tiến 1s → 2s → 4s + jitter.
      // Jitter quan trọng khi nhiều lượt chạy song song: không có nó thì tất cả
      // cùng thử lại một thời điểm và lại bị chặn tiếp.
      const cho = 1000 * 2 ** (lan - 1) + Math.floor(Math.random() * 500);
      // Nghỉ backoff mà hết luôn ngân sách thì vô nghĩa — dừng, trả lỗi cuối
      // để caller còn kịp soạn câu trả lời từ dữ liệu đã tra.
      if (args.hanChotMs && Date.now() + cho >= args.hanChotMs - 1_000) {
        throw loiCuoi ?? new Error('hết ngân sách thời gian khi chờ thử lại');
      }
      await nghi(cho);
    }

    const controller = new AbortController();
    // Timeout NGẮN DẦN theo số lần thử: 12s → 20s → 30s → 40s.
    //
    // Vì sao không để cố định: đo thực tế 120 ca, lượt bình thường 3-8s. Gateway
    // kẹt quá 12s gần như chắc chắn hỏng — cắt sớm rồi thử lại nhanh hơn nhiều so
    // với chờ hết 25s. Nhưng lần thử sau phải nới rộng, phòng khi mạng thật sự chậm.
    const hanMongMuon = args.timeoutMs ?? [12_000, 20_000, 30_000, 40_000][Math.min(lan, 3)];
    // Không lần gọi nào được vượt phần còn lại của ngân sách lượt (11/08).
    const hanCho = args.hanChotMs
      ? Math.min(hanMongMuon, Math.max(args.hanChotMs - Date.now(), 0))
      : hanMongMuon;
    // Còn quá ít thì gọi cũng không kịp — dừng, để caller trả cái đang có.
    if (args.hanChotMs && hanCho < 1_000) {
      throw loiCuoi ?? new Error('hết ngân sách thời gian trước khi gọi model');
    }
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

      return docPhanHoi(await docJson(response));
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

/**
 * NHÌN ẢNH — gửi một ảnh + lời dặn, nhận mô tả bằng chữ.
 *
 * Tách khỏi `generateWithOpenaiCompatTools` vì việc này khác hẳn: không tool,
 * không vòng lặp, và dùng MODEL KHÁC (model chat của prod không nhìn được ảnh
 * — đo thật 10/08: OpenRouter trả 404 "No endpoints found that support image
 * input" cho deepseek-v4-flash).
 *
 * Ảnh đi bằng data: URI thay vì link: link media của Zalo/MinIO nằm sau mạng
 * nội bộ, OpenRouter không với tới được.
 */
export async function nhinAnhOpenaiCompat(args: {
  /** URL ĐẦY ĐỦ tới /chat/completions — dùng chung duongDanChat() với luồng chat. */
  url: string;
  apiKey: string;
  model: string;
  loiDan: string;
  anhBase64: string;
  kieuAnh: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<string> {
  const res = await fetch(args.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: JSON.stringify({
      model: args.model,
      max_tokens: args.maxTokens ?? 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: args.loiDan },
          {
            type: 'image_url',
            image_url: { url: `data:${args.kieuAnh};base64,${args.anhBase64}` },
          },
        ],
      }],
    }),
    signal: AbortSignal.timeout(args.timeoutMs ?? 45_000),
  });

  const j = (await docJson(res)) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string } }>;
  };
  if (j.error) throw new Error(`nhìn ảnh lỗi: ${j.error.message ?? 'không rõ'}`);
  return String(j.choices?.[0]?.message?.content ?? '').trim();
}
