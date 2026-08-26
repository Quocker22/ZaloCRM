// SPDX-License-Identifier: AGPL-3.0-or-later
// Agent giám sát (26/08) — ca thật 09:21: bot chép nguyên output tool
//   "KHÔNG sửa được đơn: so_luong phải > 0, nhận: 0
//    Báo rõ lý do cho nhân viên, ĐỪNG nói đã sửa xong."
// kèm "(Em mới tra được tới đây thôi ạ…)" ra nhóm. Anh Quốc: "bot nó cứ ngu
// như này à?… phải tích hợp thêm một con agent giám sát".
import { describe, it, expect, vi } from 'vitest';
import {
  giamSatTraLoi, dongDanModelBiChep, botDongBiChep, modelGiamSat, giamSatDangBat,
} from '../../../src/modules/ai/agent/giam-sat.js';
import type { AgentTurn } from '../../../src/modules/ai/agent/types.js';

const OUTPUT_TOOL =
  'KHÔNG sửa được đơn: so_luong phải > 0, nhận: 0\n' +
  'Báo rõ lý do cho nhân viên, ĐỪNG nói đã sửa xong.';
const BAN_NHAP_09_21 =
  'KHÔNG sửa được đơn: so_luong phải > 0, nhận: 0\n' +
  'Báo rõ lý do cho nhân viên, ĐỪNG nói đã sửa xong.\n\n' +
  '(Em mới tra được tới đây thôi ạ, anh/chị cần thêm gì nhắn em nhé.)';
const LOG = [{
  toolName: 'sua_don',
  input: { doi: [{ so_luong: 0, san_pham_id: 1026 }], them: [{ don_gia: 13000, so_luong: 160, san_pham_id: 552 }], ma_don: 'S15264' },
  output: OUTPUT_TOOL, thanhCong: false, durationMs: 800, iteration: 1,
}];
const VAO = {
  cauNv: '160 thanh giá 13k, giữ 15 nguồn 12v4000w',
  lichSu: [{ vai: 'bot' as const, noiDung: 'Anh/chị cho em hỏi rõ thêm: số lượng bao nhiêu thanh tỏa…' }],
  log: LOG,
  traLoi: BAN_NHAP_09_21,
};
const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const turnPhanQuyet = (input: Record<string, unknown>): AgentTurn => ({
  text: '', stopReason: 'tool_use', raw: null, usage,
  toolCalls: [{ id: 'g1', name: 'phan_quyet', input }],
});

describe('dongDanModelBiChep — hàng rào code tối thiểu', () => {
  it('bắt đúng dòng dặn-model bị chép nguyên văn từ output tool', () => {
    expect(dongDanModelBiChep(BAN_NHAP_09_21, LOG)).toEqual(['Báo rõ lý do cho nhân viên, ĐỪNG nói đã sửa xong.']);
  });
  it('bản nháp bình thường → không có gì', () => {
    expect(dongDanModelBiChep('Dạ em chưa sửa được đơn S15264 vì số lượng dòng cũ đang là 0 ạ.', LOG)).toEqual([]);
  });
  it('botDongBiChep lột dòng đó', () => {
    expect(botDongBiChep(BAN_NHAP_09_21, ['Báo rõ lý do cho nhân viên, ĐỪNG nói đã sửa xong.'])).not.toContain('ĐỪNG nói');
  });
});

describe('giamSatTraLoi', () => {
  it('model phán ok=false + bản sửa → dùng bản sửa (đã lột nốt dòng dặn nếu còn)', async () => {
    const generate = vi.fn(async () => turnPhanQuyet({
      ok: false, loi: ['lo_noi_bo', 'giau_loi_tool'],
      tra_loi_sua: 'Dạ em chưa sửa được đơn S15264: dòng "led thanh 1m 5054 trắng" không đặt SL 0 được, em cần bỏ hẳn dòng đó. Anh/chị nhắn "bỏ led thanh 1m 5054" rồi em thêm 160 thanh toả Lixin 13k ạ.',
      ly_do: 'chép output tool + không nói bước tiếp',
    }));
    const pq = await giamSatTraLoi(generate, VAO);
    expect(pq.ok).toBe(false);
    expect(pq.loi).toEqual(['lo_noi_bo', 'giau_loi_tool']);
    expect(pq.nguon).toBe('llm');
    expect(pq.traLoiSua).toContain('chưa sửa được đơn S15264');
    expect(pq.traLoiSua).not.toContain('ĐỪNG nói');
    // Prompt gửi model phải có đủ ngữ cảnh: câu NV, tool + output thô, bản nháp, và gợi ý của code.
    const goi = generate.mock.calls[0][0];
    const nd = String(goi.messages[0].content);
    expect(nd).toContain('160 thanh giá 13k');
    expect(nd).toContain('sua_don THẤT BẠI');
    expect(nd).toContain('CODE PHÁT HIỆN');
    expect(goi.tools.map((t) => t.name)).toEqual(['phan_quyet']);
  });

  it('model phán ok → gửi nguyên bản', async () => {
    const generate = vi.fn(async () => turnPhanQuyet({ ok: true, loi: [] }));
    const pq = await giamSatTraLoi(generate, { ...VAO, traLoi: 'Dạ em chưa sửa được đơn ạ.', log: [] });
    expect(pq).toMatchObject({ ok: true, loi: [], nguon: 'llm' });
    expect(pq.traLoiSua).toBeUndefined();
  });

  it('model TIMEOUT → fail-open: vẫn lột dòng dặn bị chép, không chặn tin', async () => {
    const generate = vi.fn(() => new Promise<AgentTurn>(() => { /* treo */ }));
    const pq = await giamSatTraLoi(generate, VAO, 30);
    expect(pq.nguon).toBe('fail_open');
    expect(pq.loi).toEqual(['lo_noi_bo']);
    expect(pq.traLoiSua).not.toContain('ĐỪNG nói');
    expect(pq.traLoiSua).toContain('KHÔNG sửa được đơn');
  });

  it('model báo lỗi mà KHÔNG đưa bản sửa → không tin, fail-open', async () => {
    const generate = vi.fn(async () => turnPhanQuyet({ ok: false, loi: ['bia_so'] }));
    const pq = await giamSatTraLoi(generate, { ...VAO, traLoi: 'Tổng 1.320.000đ ạ.', log: [] });
    expect(pq.nguon).toBe('fail_open');
    expect(pq.traLoiSua).toBeUndefined();
  });

  it('model không gọi tool (trả text) → fail-open', async () => {
    const generate = vi.fn(async (): Promise<AgentTurn> => ({ text: 'ok', stopReason: 'end_turn', raw: null, usage, toolCalls: [] }));
    expect((await giamSatTraLoi(generate, { ...VAO, log: [], traLoi: 'Dạ vâng ạ.' })).nguon).toBe('fail_open');
  });
});

describe('cấu hình', () => {
  it('model giám sát mặc định KHÁC model chính, đổi qua env', () => {
    expect(modelGiamSat({} as NodeJS.ProcessEnv)).toBe('openai/gpt-4.1-mini');
    expect(modelGiamSat({ AI_MODEL_GIAM_SAT: 'x/y' } as NodeJS.ProcessEnv)).toBe('x/y');
  });
  it('mặc định BẬT, AI_GIAM_SAT_TAT=1 tắt khẩn', () => {
    expect(giamSatDangBat({} as NodeJS.ProcessEnv)).toBe(true);
    expect(giamSatDangBat({ AI_GIAM_SAT_TAT: '1' } as NodeJS.ProcessEnv)).toBe(false);
  });
});
