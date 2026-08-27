// SPDX-License-Identifier: AGPL-3.0-or-later
// VÒNG KIỂM CHỨNG — "harness" cho con giám sát / con điều phối (27/08, anh Quốc:
// "áp dụng deepseek-harness để suy nghĩ của con giám sát thông minh hơn, đưa
// ra quyết định đúng đắn hơn").
//
// Lấy từ deepseek-harness (dsh-goal + dsh-goal-round-driver + tool-result-
// pruner): thay vì phán MỘT PHÁT từ bản nháp, model được ĐI NHIỀU VÒNG theo
// một mục tiêu — mỗi vòng nó suy nghĩ riêng (reasoning bật), được gọi tool
// CHỈ ĐỌC để kiểm chứng (khách này có thật không? đơn S15274 của ai? giá SP
// bao nhiêu?), kết quả tool bị cắt gọn rồi đưa lại, và chỉ được kết thúc bằng
// TOOL CUỐI có cấu trúc. Hết vòng / hết giờ / lặp tool → ép chốt bằng dữ liệu
// đang có; vẫn không chốt được → trả 'khong_chot' để caller fail-open.
//
// Vì sao khác hẳn một lượt LLM: ca 10:36 26/08 bản nháp "đã in đơn QC Bách
// Phát" trong khi tool in S15274 của Tấn Anh — giám sát một phát chỉ so chữ,
// nên ok=true. Có vòng kiểm chứng, nó tra S15274 → thấy chủ đơn khác → bắt.
import { logger } from '../../../../shared/utils/logger.js';
import type { AgentMessage, ToolAwareGenerate, ToolCall, ToolDefinition } from '../types.js';

export interface ToolKiemChung {
  definition: ToolDefinition;
  run: (input: unknown) => Promise<string>;
}

export interface BangChung {
  tool: string;
  input: unknown;
  output: string;
  ms: number;
}

export interface KetQuaVong {
  /** Input của tool cuối (đã được model gọi) — null khi không chốt được. */
  chot: Record<string, unknown> | null;
  bangChung: BangChung[];
  soVong: number;
  ms: number;
  nguon: 'chot' | 'ep_chot' | 'khong_chot';
  lyDo?: string;
}

export interface VaoVong {
  generate: ToolAwareGenerate;
  system: string;
  userMessage: string;
  /** Tool CHỈ ĐỌC để kiểm chứng. */
  kiemChung: ToolKiemChung[];
  /** Tool kết thúc — model PHẢI gọi để chốt. */
  toolCuoi: ToolDefinition;
  toiDaVong?: number;
  timeoutMs?: number;
  maxTokens?: number;
  /** Kết quả tool bị cắt còn chừng này ký tự (tool-result pruner). */
  tranKetQua?: number;
}

export const TOI_DA_VONG_MAC_DINH = 3;
export const TIMEOUT_VONG_MAC_DINH = 15_000;
const TRAN_KET_QUA_MAC_DINH = 700;

/** Cắt gọn kết quả tool — giữ đầu (thường là dòng quan trọng) + báo đã cắt. */
export function catGon(s: string, tran: number): string {
  const t = String(s ?? '').trim();
  return t.length <= tran ? t : `${t.slice(0, tran)}\n…(cắt ${t.length - tran} ký tự)`;
}

export async function chayVongKiemChung(vao: VaoVong): Promise<KetQuaVong> {
  const t0 = Date.now();
  const toiDaVong = Math.max(1, vao.toiDaVong ?? TOI_DA_VONG_MAC_DINH);
  const timeoutMs = vao.timeoutMs ?? TIMEOUT_VONG_MAC_DINH;
  const tran = vao.tranKetQua ?? TRAN_KET_QUA_MAC_DINH;
  const hanChot = t0 + timeoutMs;
  const bangChung: BangChung[] = [];
  const messages: AgentMessage[] = [{ role: 'user', content: vao.userMessage }];
  const daGoi = new Set<string>();
  const tools = [...vao.kiemChung.map((k) => k.definition), vao.toolCuoi];
  const conGio = (): number => hanChot - Date.now();
  let soVong = 0;

  // Lượt ÉP CHỐT tắt reasoning: bằng chứng đã nằm trong ngữ cảnh, chỉ cần
  // điền tool — đo e2e 27/08: 2 vòng tra + 1 vòng chốt có reasoning vượt 25s.
  const GIO_EP_MS = Math.min(8_000, timeoutMs);
  const goiModel = async (chiToolCuoi: boolean) => {
    const ms = chiToolCuoi ? Math.max(conGio(), GIO_EP_MS) : conGio();
    if (ms <= 500) throw new Error('hết giờ kiểm chứng');
    return Promise.race([
      vao.generate({
        system: vao.system, messages,
        tools: chiToolCuoi ? [vao.toolCuoi] : tools,
        maxTokens: vao.maxTokens ?? 1200, suyNghi: !chiToolCuoi,
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`quá ${timeoutMs}ms`)), ms)),
    ]);
  };
  const epChot = async (nguon: 'ep_chot'): Promise<KetQuaVong> => {
    messages.push({ role: 'user', content: `Hết lượt kiểm chứng. Gọi tool ${vao.toolCuoi.name} NGAY với bằng chứng đang có.` });
    const turn = await goiModel(true);
    const cuoi = turn.toolCalls.find((c) => c.name === vao.toolCuoi.name);
    if (cuoi) return { chot: cuoi.input as Record<string, unknown>, bangChung, soVong: soVong + 1, ms: Date.now() - t0, nguon };
    return { chot: null, bangChung, soVong: soVong + 1, ms: Date.now() - t0, nguon: 'khong_chot', lyDo: 'model không gọi tool cuối dù đã ép' };
  };

  try {
    while (soVong < toiDaVong) {
      soVong += 1;
      const vongCuoi = soVong === toiDaVong;
      const turn = await goiModel(false);
      const cuoi = turn.toolCalls.find((c) => c.name === vao.toolCuoi.name);
      if (cuoi) {
        return { chot: cuoi.input as Record<string, unknown>, bangChung, soVong, ms: Date.now() - t0, nguon: 'chot' };
      }
      const goiKiem = turn.toolCalls.filter((c) => c.name !== vao.toolCuoi.name);
      if (goiKiem.length === 0) {
        // Trả text/không gọi gì → nhắc chốt bằng tool cuối.
        messages.push({ role: 'assistant', content: turn.raw as unknown[] });
        messages.push({ role: 'user', content: `Bạn chưa chốt. Hãy gọi tool ${vao.toolCuoi.name} ngay với dữ liệu đang có.` });
        continue;
      }
      messages.push({ role: 'assistant', content: turn.raw as unknown[] });
      const ketQua = await Promise.all(goiKiem.map(async (call: ToolCall) => {
        const chuKy = `${call.name}:${JSON.stringify(call.input)}`;
        const lap = daGoi.has(chuKy);
        daGoi.add(chuKy);
        const tool = vao.kiemChung.find((k) => k.definition.name === call.name);
        const tb = Date.now();
        let output: string;
        if (!tool) output = `Không có tool ${call.name}.`;
        else if (lap) output = 'Bạn vừa gọi y hệt tham số này — kết quả không đổi. Chốt bằng dữ liệu đang có.';
        else {
          try { output = await tool.run(call.input); } catch (err) { output = `Tool lỗi: ${err instanceof Error ? err.message : String(err)}`; }
        }
        const out = catGon(output, tran);
        bangChung.push({ tool: call.name, input: call.input, output: out, ms: Date.now() - tb });
        return { type: 'tool_result', tool_use_id: call.id, content: out };
      }));
      messages.push({ role: 'user', content: ketQua });
      if (vongCuoi) break;
    }
    // Hết vòng mà chưa chốt → một lượt CHỈ có tool cuối (nhanh, không reasoning).
    return await epChot('ep_chot');
  } catch (err) {
    logger.warn({ err, soVong }, '[harness] vòng kiểm chứng lỗi/hết giờ');
    // Hết giờ (kể cả chưa có bằng chứng — prod 27/08: 4/11 lượt điều phối
    // vượt 25s ngay vòng reasoning đầu) → vẫn thử MỘT lượt ép chốt nhanh
    // TẮT reasoning (8s riêng): chậm 8s còn hơn mất cả lượt.
    try { return await epChot('ep_chot'); } catch (err2) { logger.warn({ err: err2 }, '[harness] ép chốt cũng hỏng'); }
    return { chot: null, bangChung, soVong, ms: Date.now() - t0, nguon: 'khong_chot', lyDo: err instanceof Error ? err.message : String(err) };
  }
}

/** Bằng chứng dạng chữ để nhét vào log/lý do. */
export function tomTatBangChung(bc: BangChung[]): string {
  return bc.map((b) => `${b.tool}(${JSON.stringify(b.input).slice(0, 120)}) → ${b.output.replace(/\n/g, ' ').slice(0, 200)}`).join('\n');
}
