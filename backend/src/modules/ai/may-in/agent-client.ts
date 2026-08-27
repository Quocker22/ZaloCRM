// SPDX-License-Identifier: AGPL-3.0-or-later
// AgentClient — bọc AgentRegistry (Task 1) thành ClientMayIn (hang-doi-in.ts)
// để chayMotLuotIn dùng được thay IppClient, KHÔNG đổi gì ở hàng đợi.
//
// PHÂN LOẠI LỖI khớp đúng luật A3 (xem ipp-client.ts) — nguồn phân loại ở
// đây là LOẠI LỖI mà AgentRegistry.guiJob ném ra:
//   AgentKhongOnline  → agent PC chưa kết nối, CHẮC CHẮN chưa gửi gì
//                        → LoiIpp guiDuoc=false (hàng đợi retry thoải mái).
//   AgentRotGiuaChung → agent ngắt kết nối GIỮA LÚC đang chờ trả lời, có thể
//                        job đã tới PC/máy in → LoiKhongRo (cấm gửi lại mù).
//   còn lại (agent trả trangThai:'loi', VD máy in hết giấy) → agent ĐÃ nhận
//                        và đã trả lời rõ ràng là lỗi → LoiIpp guiDuoc=true.
//
// VÌ SAO instanceof thay vì regex message (fix round 1 — review): match
// substring của Error.message giòn — đổi câu chữ (dịch lại, refactor) là lỗi
// rơi vào catch-all LoiIpp(guiDuoc=true), tức coi lỗi mơ hồ là "retry được".
// Đó là hướng SAI AN TOÀN cho luật A3. `instanceof` không phụ thuộc câu chữ.
import { AgentRegistry, AgentKhongOnline, AgentRotGiuaChung, type JobIn } from './agent-registry.js';
import { LoiIpp, LoiKhongRo } from './ipp-client.js';
import type { ClientMayIn } from './hang-doi-in.js';
import type { PhanHoiIpp } from './giao-thuc-ipp.js';

export interface AgentClientConfig {
  paperSize: string;
  tray: string;
  copies?: number;
}

/**
 * PhanHoiIpp giả — ClientMayIn bắt buộc trả field này (dùng cho log/debug ở
 * IppClient) nhưng agent không nói giao thức IPP nên không có gì thật để trả.
 */
function phanHoiRong(): PhanHoiIpp {
  return { thanhCong: true, status: 0, requestId: 0, thuocTinh: {} };
}

export class AgentClient implements ClientMayIn {
  private demJob = 0;

  constructor(
    private readonly registry: AgentRegistry,
    private readonly orgId: string,
    private readonly cfg: AgentClientConfig,
  ) {}

  async inPdf(pdf: Buffer, tenJob: string): Promise<{ jobId: number | null; phanHoi: PhanHoiIpp }> {
    const job: JobIn = {
      id: this.taoJobId(),
      pdfBase64: pdf.toString('base64'),
      paperSize: this.cfg.paperSize,
      tray: this.cfg.tray,
      copies: this.cfg.copies ?? 1,
    };
    let kq;
    try {
      kq = await this.registry.guiJob(this.orgId, job);
    } catch (err) {
      throw this.phanLoaiLoi(err);
    }
    if (kq.trangThai === 'loi') {
      // Agent đã nhận job và máy in ĐÃ trả lời từ chối — rõ ràng, retry an toàn.
      throw new LoiIpp(kq.loiCuoi ?? 'Agent báo lỗi in', true);
    }
    // jobId luôn null: agent không nói giao thức IPP nên không có job-id máy
    // in thật nào để trả. Fix round 1 (review) — trước đây cứng =1, ghi vào
    // cột ippJobId của DB thành giá trị vô nghĩa; hang-doi-in.ts.xacMinh() đã
    // tự return sớm khi ippJobId==null nên không poll vô ích mỗi cron.
    return { jobId: null, phanHoi: phanHoiRong() };
  }

  async traTrangThaiJob(_jobId: number): Promise<{ jobState: number | null; phanHoi: PhanHoiIpp }> {
    // Agent không có khái niệm job-id máy in (không nói IPP) — không xác minh
    // được gì thêm. Hàng đợi thấy jobState:null thì GIỮ NGUYÊN trạng thái
    // hiện tại (khong_ro), không tự chuyển — an toàn hơn đoán bừa.
    return { jobState: null, phanHoi: phanHoiRong() };
  }

  private taoJobId(): string {
    this.demJob += 1;
    return `${this.orgId}-${Date.now()}-${this.demJob}`;
  }

  private phanLoaiLoi(err: unknown): Error {
    if (err instanceof AgentKhongOnline) {
      return new LoiIpp(err.message, false);
    }
    if (err instanceof AgentRotGiuaChung) {
      return new LoiKhongRo(err.message);
    }
    // Lỗi khác không rõ nguồn gốc (không phải 2 lỗi có chủ ý của registry) —
    // coi như agent đã trả lời rõ ràng là lỗi, retry an toàn.
    const msg = err instanceof Error ? err.message : String(err);
    return new LoiIpp(msg, true);
  }
}
