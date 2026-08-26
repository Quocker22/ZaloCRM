// SPDX-License-Identifier: AGPL-3.0-or-later
// Ghi nhật ký gọi tool xuống bảng `tool_call_logs`.
//
// VÌ SAO CẦN: khi bot trả lời sai, câu trả lời cuối KHÔNG cho biết vì sao — phải
// biết nó gọi tool nào, truyền gì, Odoo trả gì. Trước đây `ghiLog` chỉ là callback
// rỗng nên mọi chẩn đoán đều phải diễn lại bằng tay.
import type { ToolCallLog } from './staff-agent.js';

/** Cắt `output` trước khi ghi: một truy vấn sản phẩm có thể trả về hàng chục KB. */
const MAX_OUTPUT = 4000;

/** Client tối thiểu — nhận cả PrismaClient thật lẫn bản giả trong test. */
export interface PrismaGhiLog {
  toolCallLog: { create: (a: { data: Record<string, unknown> }) => Promise<unknown> };
}

export interface ThamSoGhiLog {
  prisma: PrismaGhiLog;
  orgId: string;
  /** 'giam_sat' (26/08) = phán quyết của agent giám sát — đo chặn bao nhiêu/đúng bao nhiêu. */
  vai: 'nhanvien' | 'khach' | 'giam_sat';
  conversationId?: string;
  /** Nhận lỗi ghi log. Mặc định im lặng — xem `taoGhiLog`. */
  onError?: (err: unknown) => void;
}

export function catOutput(s: string): string {
  return s.length <= MAX_OUTPUT ? s : `${s.slice(0, MAX_OUTPUT)}…`;
}

/**
 * Dựng callback `ghiLog` cho agent.
 *
 * KHÔNG await và KHÔNG ném lỗi: quan trắc hỏng thì bot vẫn phải trả lời khách.
 * Đây là lý do trả về `void` chứ không phải Promise — người gọi không thể vô ý
 * chờ nó và làm chậm câu trả lời.
 */
export function taoGhiLog(ts: ThamSoGhiLog): (l: ToolCallLog) => void {
  return (l) => {
    void ts.prisma.toolCallLog
      .create({
        data: {
          orgId: ts.orgId,
          conversationId: ts.conversationId ?? null,
          vai: ts.vai,
          toolName: l.toolName,
          // `input` có thể chứa giá trị không tuần tự hoá được (undefined,
          // BigInt từ Odoo). Chuẩn hoá qua JSON để Prisma không ném.
          input: chuanHoaJson(l.input),
          output: catOutput(l.output),
          thanhCong: l.thanhCong,
          durationMs: l.durationMs,
          iteration: l.iteration,
        },
      })
      .catch((err: unknown) => {
        ts.onError?.(err);
      });
  };
}

/** Ép về JSON hợp lệ; hỏng thì lưu chuỗi mô tả thay vì làm rơi cả bản ghi. */
export function chuanHoaJson(v: unknown): unknown {
  try {
    return JSON.parse(
      JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? String(x) : x)),
    );
  } catch {
    return { khongTuanTuHoaDuoc: String(v) };
  }
}
