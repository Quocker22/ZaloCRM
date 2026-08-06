// SPDX-License-Identifier: AGPL-3.0-or-later
// Test vòng lặp agentic. Bốn quy tắc bắt buộc trong loop.ts đều có test riêng ở đây.
import { describe, it, expect, vi } from 'vitest';
import { runAgent, DEFAULT_MAX_ITERATIONS } from '../../../src/modules/ai/agent/loop.js';
import type { AgentTurn, ToolDefinition } from '../../../src/modules/ai/agent/types.js';

const tools: ToolDefinition[] = [
  {
    name: 'tra_gia',
    description: 'Tra giá sản phẩm',
    inputSchema: { type: 'object', properties: { ten: { type: 'string' } }, required: ['ten'] },
  },
];

/** Provider giả trả lần lượt các lượt đã dựng sẵn; hết thì lặp lại lượt cuối. */
function fakeProvider(turns: AgentTurn[]) {
  let i = 0;
  return vi.fn(async () => turns[Math.min(i++, turns.length - 1)]);
}

const turnCallingTool = (id = 't1', name = 'tra_gia'): AgentTurn => ({
  text: '',
  toolCalls: [{ id, name, input: { ten: 'P10' } }],
  stopReason: 'tool_use',
  raw: [{ type: 'tool_use', id, name, input: { ten: 'P10' } }],
});

const turnDone = (text = 'Giá P10 là 120.000đ'): AgentTurn => ({
  text,
  toolCalls: [],
  stopReason: 'end_turn',
  raw: [{ type: 'text', text }],
});

const base = {
  system: 'Bạn là trợ lý bán hàng',
  userMessage: 'P10 giá bao nhiêu?',
  tools,
};

describe('runAgent — luồng cơ bản', () => {
  it('model trả lời thẳng, không gọi tool → 1 vòng, trả text', async () => {
    const generate = fakeProvider([turnDone('Dạ shop mở 9h-22h ạ')]);
    const execute = vi.fn();

    const r = await runAgent({ ...base, generate, execute });

    expect(r.text).toBe('Dạ shop mở 9h-22h ạ');
    expect(r.iterations).toBe(1);
    expect(r.stopReason).toBe('end_turn');
    expect(execute).not.toHaveBeenCalled();
  });

  it('gọi 1 tool rồi trả lời → 2 vòng, tool chạy đúng 1 lần', async () => {
    const generate = fakeProvider([turnCallingTool(), turnDone()]);
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: '120000' }));

    const r = await runAgent({ ...base, generate, execute });

    expect(r.iterations).toBe(2);
    expect(r.stopReason).toBe('end_turn');
    expect(r.text).toBe('Giá P10 là 120.000đ');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0].call.name).toBe('tra_gia');
  });

  it('nhiều tool trong 1 lượt → chạy hết, gộp vào MỘT message user (quy tắc 2)', async () => {
    const multi: AgentTurn = {
      text: '',
      toolCalls: [
        { id: 'a', name: 'tra_gia', input: { ten: 'P10' } },
        { id: 'b', name: 'tra_gia', input: { ten: 'P4' } },
      ],
      stopReason: 'tool_use',
      raw: [{ type: 'tool_use', id: 'a' }, { type: 'tool_use', id: 'b' }],
    };
    const generate = fakeProvider([multi, turnDone()]);
    const execute = vi.fn(async (c) => ({ toolCallId: c.id, content: 'ok' }));

    const r = await runAgent({ ...base, generate, execute });

    expect(execute).toHaveBeenCalledTimes(2);
    // history: [user đầu, assistant, user(gộp 2 kết quả)] — KHÔNG tách thành 2 message.
    const userMsgs = r.messages.filter((m) => m.role === 'user');
    expect(userMsgs).toHaveLength(2);
    expect(userMsgs[1].content).toHaveLength(2);
  });
});

describe('runAgent — history (quy tắc 1)', () => {
  it('đẩy NGUYÊN VẸN content thô của assistant, không phải text đã trích', async () => {
    const generate = fakeProvider([turnCallingTool(), turnDone()]);
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: '120000' }));

    const r = await runAgent({ ...base, generate, execute });

    const assistantMsg = r.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    // Phải là mảng content block, không phải string.
    expect(Array.isArray(assistantMsg!.content)).toBe(true);
    expect(assistantMsg!.content).toEqual([
      { type: 'tool_use', id: 't1', name: 'tra_gia', input: { ten: 'P10' } },
    ]);
  });

  it('lượt sau nhận được history có kết quả tool của lượt trước', async () => {
    const generate = fakeProvider([turnCallingTool(), turnDone()]);
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: 'GIÁ=120000' }));

    await runAgent({ ...base, generate, execute });

    // Lần gọi thứ 2 phải thấy đủ 3 message.
    const secondCall = generate.mock.calls[1][0];
    expect(secondCall.messages).toHaveLength(3);
    expect(secondCall.messages[2].content).toEqual([
      { toolCallId: 't1', content: 'GIÁ=120000' },
    ]);
  });
});

describe('runAgent — chặn vòng lặp vô hạn (quy tắc 4)', () => {
  // Đây là test cho ca thất bại có thật: 2 agent gọi vòng qua lại nhau,
  // chạy 11 ngày, hoá đơn API 47.000 USD.
  it('model LUÔN đòi gọi tool → dừng ở maxIterations, KHÔNG treo', async () => {
    const generate = fakeProvider([turnCallingTool()]); // không bao giờ end_turn
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: 'ok' }));

    const r = await runAgent({ ...base, generate, execute, maxIterations: 3 });

    expect(r.stopReason).toBe('max_iterations');
    expect(r.iterations).toBe(3);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('mặc định có trần, không phải vô hạn', async () => {
    const generate = fakeProvider([turnCallingTool()]);
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: 'ok' }));

    const r = await runAgent({ ...base, generate, execute });

    expect(r.iterations).toBe(DEFAULT_MAX_ITERATIONS);
    expect(r.stopReason).toBe('max_iterations');
  });

  it('maxIterations=0 hoặc âm → ép về tối thiểu 1, không lặp vô hạn', async () => {
    const generate = fakeProvider([turnCallingTool()]);
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: 'ok' }));

    const r = await runAgent({ ...base, generate, execute, maxIterations: 0 });

    expect(r.iterations).toBe(1);
    expect(r.stopReason).toBe('max_iterations');
  });

  it('chạm trần → stopReason KHÔNG phải end_turn (tầng gọi phải phân biệt được)', async () => {
    // Quan trọng: câu trả lời lúc này CHƯA HOÀN CHỈNH, không được gửi cho khách.
    const generate = fakeProvider([
      { ...turnCallingTool(), text: 'Để em kiểm tra...' },
    ]);
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: 'ok' }));

    const r = await runAgent({ ...base, generate, execute, maxIterations: 2 });

    expect(r.stopReason).not.toBe('end_turn');
    expect(r.text).toBe('Để em kiểm tra...'); // có text nhưng dở dang
  });
});

describe('runAgent — lỗi tool (quy tắc 3)', () => {
  it('tool ném exception → vẫn trả tool_result isError, vòng lặp KHÔNG sập', async () => {
    const generate = fakeProvider([turnCallingTool(), turnDone('Dạ em chưa tra được ạ')]);
    const execute = vi.fn(async () => { throw new Error('Odoo mất kết nối'); });

    const r = await runAgent({ ...base, generate, execute });

    expect(r.stopReason).toBe('end_turn');
    expect(r.toolCalls[0].result.isError).toBe(true);
    expect(r.toolCalls[0].result.content).toContain('Odoo mất kết nối');
  });

  it('lỗi tool được đưa NGƯỢC cho model để nó tự sửa', async () => {
    const generate = fakeProvider([turnCallingTool(), turnDone()]);
    const execute = vi.fn(async () => { throw new Error('không tìm thấy SP'); });

    await runAgent({ ...base, generate, execute });

    const secondCall = generate.mock.calls[1][0];
    const results = secondCall.messages[2].content as Array<{ isError?: boolean }>;
    expect(results[0].isError).toBe(true);
  });

  it('1 tool lỗi, 1 tool ổn → cả hai kết quả đều được trả về', async () => {
    const multi: AgentTurn = {
      text: '',
      toolCalls: [
        { id: 'a', name: 'tra_gia', input: { ten: 'P10' } },
        { id: 'b', name: 'tra_gia', input: { ten: 'P4' } },
      ],
      stopReason: 'tool_use',
      raw: [],
    };
    const generate = fakeProvider([multi, turnDone()]);
    const execute = vi.fn(async (c) => {
      if (c.id === 'a') throw new Error('lỗi a');
      return { toolCallId: c.id, content: 'ok b' };
    });

    const r = await runAgent({ ...base, generate, execute });

    expect(r.toolCalls).toHaveLength(2);
    expect(r.toolCalls.find((t) => t.call.id === 'a')!.result.isError).toBe(true);
    expect(r.toolCalls.find((t) => t.call.id === 'b')!.result.isError).toBeUndefined();
  });

  it('lỗi provider (mạng/API key) → NÉM ra ngoài, không nuốt', async () => {
    // Khác với lỗi tool: provider hỏng thì không còn gì để lặp tiếp.
    const generate = vi.fn(async () => { throw new Error('401 sai API key'); });
    const execute = vi.fn();

    await expect(runAgent({ ...base, generate, execute })).rejects.toThrow('401 sai API key');
  });
});

describe('runAgent — CHỐNG LẶP vô ích', () => {
  // Ca thật: "@bot số lượng tồn led 3 bóng" → model gọi tra_san_pham 10 lần
  // với y hệt tham số, chạm trần 8 vòng. Nhân viên chờ 8 lượt gọi LLM vô ích.

  it('gọi lại tool y hệt → chèn lời nhắc ĐỔI CÁCH', async () => {
    const generate = fakeProvider([turnCallingTool()]);   // luôn gọi y hệt
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: 'không thấy' }));

    const r = await runAgent({ ...base, generate, execute, maxIterations: 4 });

    const nhac = r.messages.filter(
      (m) => typeof m.content === 'string' && m.content.includes('ĐỔI CÁCH'),
    );
    expect(nhac).toHaveLength(1);
  });

  it('chỉ nhắc MỘT lần dù lặp nhiều vòng (không thêm nhiễu)', async () => {
    const generate = fakeProvider([turnCallingTool()]);
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: 'x' }));

    const r = await runAgent({ ...base, generate, execute, maxIterations: 6 });

    const nhac = r.messages.filter(
      (m) => typeof m.content === 'string' && m.content.includes('ĐỔI CÁCH'),
    );
    expect(nhac).toHaveLength(1);
  });

  it('tham số KHÁC nhau → KHÔNG nhắc (đó là tiến triển hợp lệ)', async () => {
    let n = 0;
    const generate = vi.fn(async (): Promise<AgentTurn> => {
      n += 1;
      if (n >= 4) return turnDone();
      const input = { ten: `từ khoá ${n}` };   // mỗi lần một tham số khác
      return {
        text: '', stopReason: 'tool_use',
        toolCalls: [{ id: `t${n}`, name: 'tra_gia', input }],
        raw: [{ type: 'tool_use', id: `t${n}`, name: 'tra_gia', input }],
      };
    });
    const execute = vi.fn(async (c) => ({ toolCallId: c.id, content: 'ok' }));

    const r = await runAgent({ ...base, generate, execute });

    const nhac = r.messages.filter(
      (m) => typeof m.content === 'string' && m.content.includes('ĐỔI CÁCH'),
    );
    expect(nhac).toHaveLength(0);
  });
});

describe('runAgent — cộng dồn usage (đo hiệu quả cache)', () => {
  const turnCoUsage = (u: Record<string, number>, tool = true): AgentTurn =>
    tool
      ? { ...turnCallingTool(), usage: u as never }
      : { ...turnDone(), usage: u as never };

  it('cộng dồn token qua mọi vòng', async () => {
    const generate = fakeProvider([
      turnCoUsage({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 1087 }),
      turnCoUsage({ inputTokens: 50, outputTokens: 30, cacheReadTokens: 1087, cacheWriteTokens: 0 }, false),
    ]);
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: 'ok' }));

    const r = await runAgent({ ...base, generate, execute });

    expect(r.usage).toEqual({
      inputTokens: 150,
      outputTokens: 50,
      cacheReadTokens: 1087,   // vòng 2 đọc lại phần tĩnh vòng 1 đã ghi
      cacheWriteTokens: 1087,
    });
  });

  it('provider không trả usage → cộng 0, KHÔNG sập', async () => {
    const generate = fakeProvider([turnCallingTool(), turnDone()]);
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: 'ok' }));

    const r = await runAgent({ ...base, generate, execute });

    expect(r.usage).toEqual({
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    });
  });

  it('chạm trần vẫn trả usage (biết đã tốn bao nhiêu trước khi bỏ cuộc)', async () => {
    const generate = fakeProvider([
      turnCoUsage({ inputTokens: 100, outputTokens: 10, cacheReadTokens: 500, cacheWriteTokens: 0 }),
    ]);
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: 'ok' }));

    const r = await runAgent({ ...base, generate, execute, maxIterations: 3 });

    expect(r.stopReason).toBe('max_iterations');
    expect(r.usage.inputTokens).toBe(300);      // 100 × 3 vòng
    expect(r.usage.cacheReadTokens).toBe(1500);
  });
});

describe('runAgent — quan trắc', () => {
  it('gọi onToolCall với thời lượng và số vòng', async () => {
    const generate = fakeProvider([turnCallingTool(), turnDone()]);
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: 'ok' }));
    const onToolCall = vi.fn();

    await runAgent({ ...base, generate, execute, onToolCall });

    expect(onToolCall).toHaveBeenCalledTimes(1);
    const info = onToolCall.mock.calls[0][0];
    expect(info.call.name).toBe('tra_gia');
    expect(info.iteration).toBe(1);
    expect(typeof info.durationMs).toBe('number');
  });

  it('hook quan trắc ném lỗi → KHÔNG làm hỏng nghiệp vụ', async () => {
    const generate = fakeProvider([turnCallingTool(), turnDone()]);
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: 'ok' }));
    const onToolCall = vi.fn(() => { throw new Error('DB log chết'); });

    const r = await runAgent({ ...base, generate, execute, onToolCall });

    expect(r.stopReason).toBe('end_turn');
  });

  it('ghi lại tool lỗi để quan trắc phát hiện "im lặng hỏng"', async () => {
    // Nghiên cứu: tool call lỗi 3-15% một cách im lặng. Không log thì không biết.
    const generate = fakeProvider([turnCallingTool(), turnDone()]);
    const execute = vi.fn(async () => { throw new Error('timeout'); });
    const onToolCall = vi.fn();

    await runAgent({ ...base, generate, execute, onToolCall });

    expect(onToolCall.mock.calls[0][0].result.isError).toBe(true);
  });
});

describe('runAgent — NHẮC LẠI khi model kết thúc bằng câu RỖNG sau tool', () => {
  // Đo thật 06/08/2026: gemini-2.5-flash-lite mắc BA LẦN trong 12 phút chat —
  // gọi tra_khach_hang xong trả rỗng, nhân viên nhận "Bot chưa xử lý xong"
  // trong khi dữ liệu tool đã nằm sẵn trong context. Một cú nhắc cứu được cả lượt.
  it('rỗng sau tool → nhắc một lần, model trả lời được ở lượt kế', async () => {
    const generate = fakeProvider([
      turnCallingTool(),
      turnDone(''),                       // kết thúc RỖNG — bệnh của flash-lite
      turnDone('Tìm thấy 10 khách tên Tuấn, anh/chị cho xin SĐT ạ'),
    ]);
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: '10 khách tên Tuấn' }));

    const kq = await runAgent({ ...base, generate, execute });

    expect(kq.text).toBe('Tìm thấy 10 khách tên Tuấn, anh/chị cho xin SĐT ạ');
    expect(kq.stopReason).toBe('end_turn');
    expect(generate).toHaveBeenCalledTimes(3);
    // Câu nhắc phải nằm trong messages gửi lượt 3.
    const goiCuoi = generate.mock.calls[2][0] as { messages: Array<{ role: string; content: unknown }> };
    const nhac = goiCuoi.messages.filter((m) => typeof m.content === 'string' && (m.content as string).includes('KHÔNG nói gì'));
    expect(nhac).toHaveLength(1);
  });

  it('chỉ nhắc MỘT lần — model lì thì chịu, trả rỗng để tầng trên xử', async () => {
    const generate = fakeProvider([turnCallingTool(), turnDone(''), turnDone('')]);
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: 'x' }));

    const kq = await runAgent({ ...base, generate, execute });

    expect(kq.text).toBe('');
    expect(generate).toHaveBeenCalledTimes(3); // tool + rỗng + nhắc-vẫn-rỗng, KHÔNG lặp nữa
  });

  it('KHÔNG nhắc khi chưa gọi tool nào — rỗng lượt đầu là chuyện khác', async () => {
    const generate = fakeProvider([turnDone('')]);
    const execute = vi.fn();

    const kq = await runAgent({ ...base, generate, execute });

    expect(generate).toHaveBeenCalledTimes(1);
    expect(kq.text).toBe('');
  });

  it('KHÔNG nhắc khi model đã có text — hành vi cũ giữ nguyên', async () => {
    const generate = fakeProvider([turnCallingTool(), turnDone('xong rồi ạ')]);
    const execute = vi.fn(async () => ({ toolCallId: 't1', content: 'x' }));

    const kq = await runAgent({ ...base, generate, execute });

    expect(kq.text).toBe('xong rồi ạ');
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
