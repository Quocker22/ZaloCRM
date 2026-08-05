// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: retry khi gateway chập chờn.
//
// Bug thật 2026-07-29: chạy 100 ca mô phỏng nhân viên, 25 ca fail đồng loạt
// trong 0.5s với lỗi "fetch failed" — 9router ngắt kết nối khi bị gọi dồn.
// Không retry thì nhân viên thấy bot "chết" giữa chừng dù chỉ là lỗi tạm thời.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateWithOpenaiCompatTools } from '../../../src/modules/ai/providers/openai-compat.js';
import type { ToolDefinition } from '../../../src/modules/ai/agent/types.js';

const tools: ToolDefinition[] = [
  {
    name: 'tra_gia',
    description: 'Tra giá',
    inputSchema: { type: 'object', properties: { ten: { type: 'string' } }, required: ['ten'] },
  },
];

const args = {
  url: 'https://gw/v1/chat/completions',
  apiKey: 'k',
  model: 'ag/gemini-3-flash',
  system: 'sys',
  messages: [{ role: 'user' as const, content: 'x' }],
  tools,
};

// `text` phải khớp `json`: từ 2026-08-05 provider đọc bằng text() rồi tự phân
// tích (docJson) để chịu được rác đầu thân mà OpenRouter hay chèn.
const THAN_OK = JSON.stringify({
  choices: [{ message: { content: 'xong' }, finish_reason: 'stop' }],
});

const OK = {
  ok: true,
  status: 200,
  json: async () => JSON.parse(THAN_OK),
  text: async () => THAN_OK,
};

const loiHTTP = (status: number) => ({
  ok: false,
  status,
  json: async () => ({}),
  text: async () => 'lỗi',
});

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('retry — lỗi TẠM THỜI', () => {
  it('"fetch failed" lần đầu → thử lại và thành công', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('fetch failed');
      return OK;
    }));

    const turn = await generateWithOpenaiCompatTools(args);

    expect(turn.text).toBe('xong');
    expect(n).toBe(2);
  });

  it('429 (bị chặn vì gọi dồn) → thử lại', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      n += 1;
      return n === 1 ? loiHTTP(429) : OK;
    }));

    expect((await generateWithOpenaiCompatTools(args)).text).toBe('xong');
    expect(n).toBe(2);
  });

  it('5xx → thử lại', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      n += 1;
      return n === 1 ? loiHTTP(503) : OK;
    }));

    expect((await generateWithOpenaiCompatTools(args)).text).toBe('xong');
  });

  it('ECONNRESET / socket → thử lại', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('socket hang up');
      return OK;
    }));

    expect((await generateWithOpenaiCompatTools(args)).text).toBe('xong');
  });

  it('TIMEOUT của ta (AbortError) → thử lại', async () => {
    // Bug thật: một ca chạy 60s rồi hỏng với "This operation was aborted".
    // Phải check err.name, không chỉ message — message không chứa "timeout".
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      n += 1;
      if (n === 1) {
        const e = new Error('This operation was aborted');
        e.name = 'AbortError';
        throw e;
      }
      return OK;
    }));

    expect((await generateWithOpenaiCompatTools(args)).text).toBe('xong');
    expect(n).toBe(2);
  });

  it('hết số lần thử → ném lỗi cuối', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('fetch failed'); }));

    await expect(
      generateWithOpenaiCompatTools({ ...args, soLanThuLai: 1 }),
    ).rejects.toThrow('fetch failed');
  });

  it('soLanThuLai=0 → gọi đúng 1 lần', async () => {
    const fn = vi.fn(async () => { throw new Error('fetch failed'); });
    vi.stubGlobal('fetch', fn);

    await expect(
      generateWithOpenaiCompatTools({ ...args, soLanThuLai: 0 }),
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('retry — lỗi VĨNH VIỄN, KHÔNG thử lại', () => {
  it('401 sai API key → ném ngay, không phí thời gian', async () => {
    const fn = vi.fn(async () => loiHTTP(401));
    vi.stubGlobal('fetch', fn);

    await expect(generateWithOpenaiCompatTools(args)).rejects.toThrow(/401/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('400 sai tham số → ném ngay', async () => {
    const fn = vi.fn(async () => loiHTTP(400));
    vi.stubGlobal('fetch', fn);

    await expect(generateWithOpenaiCompatTools(args)).rejects.toThrow(/400/);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('retry — không đổi hành vi khi thành công', () => {
  it('lần đầu OK → gọi đúng 1 lần', async () => {
    const fn = vi.fn(async () => OK);
    vi.stubGlobal('fetch', fn);

    await generateWithOpenaiCompatTools(args);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('body gửi lên GIỐNG HỆT giữa các lần thử', async () => {
    const bodies: string[] = [];
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, o: { body: string }) => {
      bodies.push(o.body);
      n += 1;
      if (n === 1) throw new Error('fetch failed');
      return OK;
    }));

    await generateWithOpenaiCompatTools(args);

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]); // không dựng lại body mỗi lần
  });
});
