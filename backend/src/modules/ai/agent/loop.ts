// SPDX-License-Identifier: AGPL-3.0-or-later
// Vòng lặp agentic: gọi LLM → chạy tool → nhét kết quả vào history → lặp
// cho tới khi model trả lời xong hoặc chạm trần vòng lặp.
//
// Bốn quy tắc bắt buộc (sai một cái là hỏng, và thường hỏng im lặng):
//   1. Đẩy NGUYÊN VẸN content của assistant vào history — không chỉ text.
//      Thiếu tool_use block thì lượt sau provider báo lỗi.
//   2. Mọi tool_result gộp vào MỘT message user. Tách ra nhiều message sẽ
//      ngầm dạy model ngừng gọi tool song song.
//   3. Tool lỗi vẫn phải trả tool_result (isError=true). Bỏ qua = model treo.
//   4. LUÔN chặn số vòng lặp. Không chặn thì một cặp tool gọi qua lại nhau
//      chạy được nhiều ngày và đốt hết hạn mức API.

import type {
  AgentMessage,
  RunAgentOptions,
  RunAgentResult,
  ToolCall,
  ToolResult,
  TurnUsage,
} from './types.js';

/** Trần vòng lặp mặc định. Đủ cho tra SP → tra tồn → tra khách → tạo đơn. */
export const DEFAULT_MAX_ITERATIONS = 8;

/** Cộng dồn usage qua các vòng. Provider không trả usage → cộng 0, không sập. */
function congUsage(tong: TurnUsage, them?: TurnUsage): TurnUsage {
  if (!them) return tong;
  return {
    inputTokens: tong.inputTokens + (them.inputTokens ?? 0),
    outputTokens: tong.outputTokens + (them.outputTokens ?? 0),
    cacheReadTokens: tong.cacheReadTokens + (them.cacheReadTokens ?? 0),
    cacheWriteTokens: tong.cacheWriteTokens + (them.cacheWriteTokens ?? 0),
  };
}

/**
 * Chạy tool và LUÔN trả về ToolResult — kể cả khi executor ném exception.
 * Đây là điểm mấu chốt: exception không được thoát ra vòng lặp, vì model đang
 * chờ kết quả cho tool_call_id đó. Không trả về thì hội thoại hỏng.
 */
async function runToolSafely(
  call: ToolCall,
  execute: RunAgentOptions['execute'],
): Promise<{ result: ToolResult; durationMs: number }> {
  const startedAt = Date.now();
  try {
    const result = await execute(call);
    return { result, durationMs: Date.now() - startedAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      // Trả lỗi cho model dưới dạng text để nó tự sửa (đổi tham số, đổi cách
      // tiếp cận, hoặc bỏ cuộc và chuyển sale) thay vì làm sập cả lượt.
      result: { toolCallId: call.id, content: `Lỗi khi chạy tool: ${message}`, isError: true },
      durationMs: Date.now() - startedAt,
    };
  }
}

/** Gọi hook quan trắc, nuốt lỗi — quan trắc hỏng không được làm hỏng nghiệp vụ. */
async function notify(
  onToolCall: RunAgentOptions['onToolCall'],
  info: Parameters<NonNullable<RunAgentOptions['onToolCall']>>[0],
): Promise<void> {
  if (!onToolCall) return;
  try {
    await onToolCall(info);
  } catch {
    /* quan trắc lỗi thì bỏ qua */
  }
}

/**
 * Chạy vòng lặp agentic tới khi xong hoặc chạm trần.
 *
 * Không bao giờ ném exception vì lỗi tool — lỗi tool được đưa ngược cho model.
 * Chỉ ném khi chính provider lỗi (mạng, sai API key…), vì lúc đó không còn gì
 * để lặp tiếp.
 */
export async function runAgent(opts: RunAgentOptions): Promise<RunAgentResult> {
  const maxIterations = Math.max(1, opts.maxIterations ?? DEFAULT_MAX_ITERATIONS);
  const messages: AgentMessage[] = [{ role: 'user', content: opts.userMessage }];
  const toolCalls: RunAgentResult['toolCalls'] = [];

  let iterations = 0;
  let lastText = '';
  /** Đếm số lần mỗi (tool, tham số) đã được gọi — phát hiện lặp vô ích. */
  const daGoi = new Map<string, number>();
  /** Chỉ nhắc model MỘT lần; nhắc nhiều lần là thêm nhiễu vào context. */
  let daNhac = false;
  let usage: TurnUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };

  // Đã nhắc model vì nó kết thúc với câu RỖNG chưa — chỉ nhắc MỘT lần.
  let daNhacRong = false;

  while (iterations < maxIterations) {
    iterations += 1;

    const turn = await opts.generate({
      system: opts.system,
      messages,
      tools: opts.tools,
      maxTokens: opts.maxTokens,
    });

    usage = congUsage(usage, turn.usage);
    if (turn.text) lastText = turn.text;

    // Model đã trả lời xong — không còn tool nào để chạy.
    if (turn.stopReason !== 'tool_use' || turn.toolCalls.length === 0) {
      // KẾT THÚC VỚI CÂU RỖNG sau khi đã gọi tool → nhắc lại MỘT lần thay vì
      // bỏ cuộc. Đo thật 06/08/2026: gemini-2.5-flash-lite mắc lỗi này BA LẦN
      // trong 12 phút chat ("lên đơn cho anh Tuấn 10 cái nguồn NB" → gọi
      // tra_khach_hang xong trả rỗng) — mỗi lần là một câu "Bot chưa xử lý
      // xong" vô ích với nhân viên, trong khi dữ liệu tool đã nằm sẵn trong
      // context. Một cú nhắc rẻ hơn nhiều so với bắt người gõ lại từ đầu.
      if (!lastText.trim() && toolCalls.length > 0 && !daNhacRong && iterations < maxIterations) {
        daNhacRong = true;
        messages.push({
          role: 'user',
          content:
            'Bạn vừa kết thúc mà KHÔNG nói gì. Hãy trả lời người dùng dựa trên ' +
            'kết quả tool ở trên — nếu còn thiếu thông tin thì hỏi lại một câu cụ thể.',
        });
        continue;
      }
      return {
        text: lastText,
        iterations,
        toolCalls,
        stopReason: turn.stopReason === 'tool_use' ? 'end_turn' : turn.stopReason,
        messages,
        usage,
      };
    }

    // QUY TẮC 1: đẩy content thô, không phải text đã trích.
    messages.push({ role: 'assistant', content: turn.raw as unknown[] });

    // Chạy song song — các tool trong cùng một lượt vốn độc lập với nhau.
    const settled = await Promise.all(
      turn.toolCalls.map(async (call) => {
        const { result, durationMs } = await runToolSafely(call, opts.execute);
        await notify(opts.onToolCall, { call, result, durationMs, iteration: iterations });
        return { call, result, durationMs };
      }),
    );
    toolCalls.push(...settled);

    // QUY TẮC 2 + 3: mọi kết quả (kể cả lỗi) gộp vào MỘT message user.
    messages.push({ role: 'user', content: settled.map((s) => s.result) });

    // CHỐNG LẶP: model đôi khi gọi Y HỆT một tool với y hệt tham số nhiều vòng
    // liền, không tiến triển gì. Ca thật: "số lượng tồn led 3 bóng" → gọi
    // tra_san_pham 10 lần, chạm trần 8 vòng, nhân viên chờ vô ích.
    // Nhắc một lần khi phát hiện — rẻ hơn nhiều so với để nó chạy hết trần.
    const chuKy = settled.map((s) => `${s.call.name}:${JSON.stringify(s.call.input)}`);
    for (const k of chuKy) {
      daGoi.set(k, (daGoi.get(k) ?? 0) + 1);
    }
    const lap = chuKy.filter((k) => (daGoi.get(k) ?? 0) >= 2);
    if (lap.length > 0 && !daNhac) {
      daNhac = true;
      messages.push({
        role: 'user',
        content:
          'Bạn vừa gọi lại tool với tham số y hệt lần trước — kết quả sẽ không đổi. ' +
          'Hãy ĐỔI CÁCH: dùng từ khoá khác/ngắn hơn, hoặc trả lời bằng dữ liệu đã có, ' +
          'hoặc dùng chuyen_sale nếu không tự làm được.',
      });
    }
  }

  // QUY TẮC 4: chạm trần. Trả về text cuối cùng có được, nhưng đánh dấu rõ là
  // CHƯA HOÀN CHỈNH — tầng gọi phải coi đây là tín hiệu chuyển sale, tuyệt đối
  // không gửi thẳng cho khách.
  return { text: lastText, iterations, toolCalls, stopReason: 'max_iterations', messages, usage };
}
