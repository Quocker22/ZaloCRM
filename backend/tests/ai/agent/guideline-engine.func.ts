// SPDX-License-Identifier: AGPL-3.0-or-later
// Function test: guideline engine nối vào luồng khách (chayTuVanKhach).
//
// Ba chế độ theo AiConfig.guidelineEngineMode:
//   off    → không gọi matcher, prompt tĩnh, registry như cũ (hành vi hôm nay)
//   shadow → matcher chạy + ghi log, nhưng prompt/registry VẪN như cũ
//   on     → prompt lắp từ guideline active, tool bị gate theo guideline
import { describe, it, expect, vi } from 'vitest';
import { chayTuVanKhach, buildCustomerSystemPrompt } from '../../../src/modules/ai/agent/customer-agent.js';
import { locTheoPhien } from '../../../src/modules/ai/agent/guideline-prompt.js';
import type { AgentTurn } from '../../../src/modules/ai/agent/types.js';
import type { OdooClient } from '../../../src/modules/ai/odoo/client.js';

const fakeOdoo = () =>
  ({ searchRead: vi.fn(async () => []), execute: vi.fn() }) as unknown as OdooClient;

const fakeLLM = (turns: AgentTurn[]) => {
  let i = 0;
  return vi.fn(async () => turns[Math.min(i++, turns.length - 1)]);
};

const text = (t: string): AgentTurn => ({
  text: t, toolCalls: [], stopReason: 'end_turn', raw: [{ type: 'text', text: t }],
});

/** Bộ guideline thu nhỏ cho test — đủ 3 loại: bat_buoc, thuong, thuong+tool ghi. */
const GS = [
  {
    ten: 'khong-hua', condition: '(luôn áp dụng)', action: 'Không hứa giảm giá.',
    mucDo: 'bat_buoc', tools: [], stage: null, uuTien: 10, yeuCau: null,
  },
  {
    ten: 'hoi-danh-muc', condition: 'khách hỏi shop bán gì', action: 'Dùng `tra_danh_muc`.',
    mucDo: 'thuong', tools: ['tra_danh_muc'], stage: 'khai_thac', uuTien: 100, yeuCau: null,
  },
  {
    ten: 'chot-mua', condition: 'khách đã chốt mua', action: 'Lên đơn ngay.',
    mucDo: 'thuong', tools: ['tao_khach_hang', 'tao_don_nhap'], stage: 'chot_don',
    uuTien: 170, yeuCau: 'tu_chot_don',
  },
];

const matcherJson = (matched: Record<string, boolean>, stage = 'khai_thac') =>
  text(JSON.stringify({ stage, matched }));

const choKhachChotDon = {
  conversationId: 'c1', seq: 0, zaloUid: null, tranTien: 10_000_000,
};

const input = { bizName: 'LEDNELIA', message: 'shop bán gì thế', history: [] };

describe('mode off (không truyền guidelineEngine) — đúng hành vi hôm nay', () => {
  it('không gọi matcher: generate được gọi đúng 1 lần, có đủ tool ngay', async () => {
    const generate = fakeLLM([text('Dạ em nghe ạ')]);

    const kq = await chayTuVanKhach(
      { odoo: fakeOdoo(), generate, ghiNhanChuyenSale: vi.fn(async () => {}) },
      input,
    );

    expect(kq.trangThai).toBe('xong');
    expect(generate).toHaveBeenCalledTimes(1);
    const call = generate.mock.calls[0][0] as { tools: Array<{ name: string }> };
    expect(call.tools.length).toBeGreaterThan(0);
  });
});

describe('mode shadow — matcher chạy + ghi log, hành vi KHÔNG đổi', () => {
  it('prompt vẫn là prompt tĩnh cũ, registry vẫn đủ tool, log được ghi', async () => {
    const generate = fakeLLM([
      matcherJson({ 'hoi-danh-muc': true, 'chot-mua': false }),
      text('Dạ shop bán đèn LED ạ'),
    ]);
    const ghiMatchLog = vi.fn();

    const kq = await chayTuVanKhach(
      {
        odoo: fakeOdoo(), generate, ghiNhanChuyenSale: vi.fn(async () => {}),
        choKhachChotDon,
        guidelineEngine: { mode: 'shadow', guidelines: GS, ghiMatchLog },
      },
      input,
    );

    expect(kq.trangThai).toBe('xong');
    // Call 2 là vòng agent: prompt phải là prompt TĨNH cũ.
    const goiAgent = generate.mock.calls[1][0] as {
      system: string; tools: Array<{ name: string }>;
    };
    expect(goiAgent.system).toBe(buildCustomerSystemPrompt('LEDNELIA', true));
    // Registry không bị gate: tool ghi vẫn có vì choKhachChotDon bật.
    expect(goiAgent.tools.map((t) => t.name)).toContain('tao_don_nhap');
    // Log matcher được ghi để soát.
    expect(ghiMatchLog).toHaveBeenCalledTimes(1);
    const log = ghiMatchLog.mock.calls[0][0];
    expect(log.stage).toBe('khai_thac');
    expect(log.matchedIds).toEqual(['hoi-danh-muc']);
    expect(log.fallback).toBe(false);
    expect(log.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('mode on — prompt lắp động, tool bị gate', () => {
  it('chỉ guideline match + bat_buoc vào prompt; tool ghi bị loại khi không match', async () => {
    const generate = fakeLLM([
      matcherJson({ 'hoi-danh-muc': true, 'chot-mua': false }),
      text('Dạ shop bán đèn LED ạ'),
    ]);

    await chayTuVanKhach(
      {
        odoo: fakeOdoo(), generate, ghiNhanChuyenSale: vi.fn(async () => {}),
        choKhachChotDon,
        guidelineEngine: { mode: 'on', guidelines: GS },
      },
      input,
    );

    const goiAgent = generate.mock.calls[1][0] as {
      system: string; tools: Array<{ name: string }>;
    };
    expect(goiAgent.system).toContain('Không hứa giảm giá.');
    expect(goiAgent.system).toContain('Dùng `tra_danh_muc`.');
    expect(goiAgent.system).not.toContain('Lên đơn ngay.');
    const tenTool = goiAgent.tools.map((t) => t.name);
    expect(tenTool).toContain('tra_san_pham');
    expect(tenTool).toContain('chuyen_sale');
    expect(tenTool).toContain('tra_danh_muc');
    // Matcher không match guideline chốt → tool ghi KHÔNG TỒN TẠI trong registry.
    expect(tenTool).not.toContain('tao_don_nhap');
    expect(tenTool).not.toContain('tao_khach_hang');
  });

  it('matcher hỏng → fallback: đủ mọi guideline + đủ tool (không tệ hơn hôm nay)', async () => {
    const generate = fakeLLM([
      text('tôi không hiểu'), // matcher trả rác → fallback
      text('Dạ em nghe ạ'),
    ]);
    const ghiMatchLog = vi.fn();

    const kq = await chayTuVanKhach(
      {
        odoo: fakeOdoo(), generate, ghiNhanChuyenSale: vi.fn(async () => {}),
        choKhachChotDon,
        guidelineEngine: { mode: 'on', guidelines: GS, ghiMatchLog },
      },
      input,
    );

    expect(kq.trangThai).toBe('xong');
    const goiAgent = generate.mock.calls[1][0] as {
      system: string; tools: Array<{ name: string }>;
    };
    expect(goiAgent.system).toContain('Dùng `tra_danh_muc`.');
    expect(goiAgent.system).toContain('Lên đơn ngay.');
    expect(goiAgent.tools.map((t) => t.name)).toContain('tao_don_nhap');
    expect(ghiMatchLog.mock.calls[0][0].fallback).toBe(true);
  });

  it('ghiMatchLog ném lỗi → không phá lượt trả lời', async () => {
    const generate = fakeLLM([
      matcherJson({ 'hoi-danh-muc': true, 'chot-mua': false }),
      text('Dạ shop bán đèn LED ạ'),
    ]);

    const kq = await chayTuVanKhach(
      {
        odoo: fakeOdoo(), generate, ghiNhanChuyenSale: vi.fn(async () => {}),
        guidelineEngine: {
          mode: 'on', guidelines: GS,
          ghiMatchLog: vi.fn(() => { throw new Error('DB chết'); }),
        },
      },
      input,
    );

    expect(kq.trangThai).toBe('xong');
  });
});

describe('locTheoPhien — chọn biến thể guideline theo cấu hình phiên', () => {
  it('tuChotDon=true giữ yeuCau tu_chot_don, bỏ khong_tu_chot_don', () => {
    const gs = [
      { ...GS[2], ten: 'a', yeuCau: 'tu_chot_don' },
      { ...GS[2], ten: 'b', yeuCau: 'khong_tu_chot_don' },
      { ...GS[1], ten: 'c', yeuCau: null },
    ];

    expect(locTheoPhien(gs, true).map((g) => g.ten)).toEqual(['a', 'c']);
    expect(locTheoPhien(gs, false).map((g) => g.ten)).toEqual(['b', 'c']);
  });
});
