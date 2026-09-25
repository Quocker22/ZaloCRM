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
import { AgentRegistry, AgentKhongOnline, AgentRotGiuaChung, AgentHetGioCho, type JobIn } from './agent-registry.js';
import { LoiIpp, LoiKhongRo } from './ipp-client.js';
import type { ClientMayIn, NguCanhGui } from './hang-doi-in.js';
import type { PhanHoiIpp } from './giao-thuc-ipp.js';
import { tenFileDayDu } from './ten-file-in.js';
import { laMaSuCo, nhanCua } from './nhat-ky.js';

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

/**
 * Bộ đếm id job DÙNG CHUNG mọi AgentClient của tiến trình — id duy nhất trong
 * tiến trình (ngữ cảnh job ở registry khoá theo id), `Date.now()` tách các lần
 * khởi động lại.
 */
let demJob = 0;

/**
 * Id print_jobs: UUID (Hermes chèn `str(uuid.uuid4())`, in lại tay theo handoff
 * §9.4 dùng `gen_random_uuid()` — ĐÂY là dạng trên prod) hoặc cuid (mặc định
 * Prisma). Giám sát vòng 3: bản trước chỉ nhận cuid → mọi job thật rơi về id
 * "<ms>-<n>", kết quả trễ sau khi deploy không bao giờ áp được.
 */
const LA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LA_CUID = /^[a-z0-9]{8,40}$/;

export function laIdPrintJob(id: string): boolean {
  return LA_UUID.test(id) || LA_CUID.test(id);
}

/** Tách id print_jobs ra khỏi id job gửi app "<printJobId>-<ms>"; không đúng dạng → null. */
export function tachPrintJobId(jobId: string): string | null {
  const m = /^(.+)-(\d{13})$/.exec(jobId);
  return m && laIdPrintJob(m[1]) ? m[1] : null;
}

export class AgentClient implements ClientMayIn {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly token: string,
    private readonly cfg: AgentClientConfig,
  ) {}

  /**
   * `tenJob` = phần gốc tên file "AI-INV_2026_030045-<Ten_Khach>" (hàng đợi
   * dựng bằng ten-file-in.taoTenFileIn). jobId sinh TẠI ĐÂY nên tên đủ
   * "<gốc>-<jobId>.pdf" cũng ghép tại đây — không nơi nào khác biết jobId.
   */
  async inPdf(
    pdf: Buffer,
    tenJob: string,
    nguCanh?: NguCanhGui,
  ): Promise<{ jobId: number | null; phanHoi: PhanHoiIpp; daInXong: boolean }> {
    const id = this.taoJobId(nguCanh?.printJobId);
    // Ghi ngữ cảnh TRƯỚC khi gửi: sự cố app báo về (chỉ mang jobId) có thể tới
    // ngay trong lúc đang chờ kết quả.
    if (nguCanh) this.registry.ghiNguCanh(id, { ...nguCanh, token: this.token });
    const job: JobIn = {
      id,
      name: tenFileDayDu(tenJob, id),
      pdfBase64: pdf.toString('base64'),
      paperSize: this.cfg.paperSize,
      tray: this.cfg.tray,
      copies: this.cfg.copies ?? 1,
    };
    let kq;
    try {
      kq = await this.registry.guiJob(this.token, job);
    } catch (err) {
      throw this.phanLoaiLoi(err);
    }
    const ma = laMaSuCo(kq.loai) ? kq.loai : undefined;
    if (kq.trangThai === 'loi') {
      // Agent đã nhận job và máy in ĐÃ trả lời từ chối — rõ ràng, retry an toàn.
      // App bản mới chỉ gửi 'loi' khi CHẮC job không còn trong hàng đợi Windows
      // (đã xoá được) — hợp đồng §0.1; mã sự cố chỉ để nhãn + nhật ký.
      throw new LoiIpp(thongDiep(ma, kq.loiCuoi, 'Agent báo lỗi in'), true, undefined, ma);
    }
    if (kq.trangThai === 'khong_ro') {
      // App đã gửi máy in mà không xác nhận được (vd kẹt giấy giữa chừng) —
      // CẤM retry: máy có thể đã in. App chỉ gửi mã này khi backend quảng bá
      // hỗ trợ qua `cau-hinh` (agent-ws.ts).
      throw new LoiKhongRo(
        thongDiep(ma, kq.loiCuoi, 'App không xác nhận được đã in'),
        ma ?? 'khong_xac_nhan',
        typeof kq.conTrongHangDoi === 'boolean' ? kq.conTrongHangDoi : undefined,
      );
    }
    // jobId luôn null: agent không nói giao thức IPP nên không có job-id máy
    // in thật nào để trả. Fix round 1 (review) — trước đây cứng =1, ghi vào
    // cột ippJobId của DB thành giá trị vô nghĩa; hang-doi-in.ts.xacMinh() đã
    // tự return sớm khi ippJobId==null nên không poll vô ích mỗi cron.
    //
    // daInXong: true — fix round 1 (review, Task 5 kiểm chéo): registry.guiJob()
    // CHỈ resolve sau khi agent gọi 'ket-qua' báo trangThai:'da_in', tức máy in
    // vật lý ĐÃ IN XONG THẬT lúc dòng này chạy tới (khác IPP: gửi xong chỉ là
    // "đã gửi", còn cần xác minh riêng). Không báo true thì hang-doi-in.ts ghi
    // da_gui rồi xacMinh() đứng yên mãi vì ippJobId==null — job kẹt vĩnh viễn,
    // không bao giờ lên da_in dù đã in xong từ lâu.
    return { jobId: null, phanHoi: phanHoiRong(), daInXong: true };
  }

  async traTrangThaiJob(_jobId: number): Promise<{ jobState: number | null; phanHoi: PhanHoiIpp }> {
    // Agent không có khái niệm job-id máy in (không nói IPP) — không xác minh
    // được gì thêm. Hàng đợi thấy jobState:null thì GIỮ NGUYÊN trạng thái
    // hiện tại (khong_ro), không tự chuyển — an toàn hơn đoán bừa.
    return { jobState: null, phanHoi: phanHoiRong() };
  }

  /**
   * "<printJobId>-<ms>" (25/09), rơi về "<ms>-<n>" khi không có id print_jobs.
   * KHÔNG chứa token: id nằm trong tên file in (ten-file-in) nên bản cũ
   * "<token>-<ms>-<n>" để token máy in hiện ở hàng đợi in Windows, trên web máy
   * in, và lọt về ZaloCRM qua `loiCuoi` (đường dẫn file tạm).
   * Mang printJobId để kết quả TRỄ vẫn tìm được đúng dòng print_jobs sau khi
   * backend khởi động lại (ngữ cảnh trong bộ nhớ mất — agent-ws tra DB theo id
   * này, kèm kiểm đúng máy). Registry khoá chờ theo token nên không cần tiền tố token.
   */
  private taoJobId(printJobId?: string): string {
    if (printJobId && laIdPrintJob(printJobId)) return `${printJobId}-${Date.now()}`;
    demJob += 1;
    return `${Date.now()}-${demJob}`;
  }

  private phanLoaiLoi(err: unknown): Error {
    if (err instanceof AgentKhongOnline) {
      return new LoiIpp(err.message, false);
    }
    if (err instanceof AgentRotGiuaChung) {
      return new LoiKhongRo(err.message);
    }
    if (err instanceof AgentHetGioCho) {
      // Lỗi 13.1: không trả lời trong hạn → không rõ, KHÔNG retry, cron chạy tiếp.
      return new LoiKhongRo(err.message, 'het_gio_cho');
    }
    // Lỗi khác không rõ nguồn gốc (không phải 2 lỗi có chủ ý của registry) —
    // coi như agent đã trả lời rõ ràng là lỗi, retry an toàn.
    const msg = err instanceof Error ? err.message : String(err);
    return new LoiIpp(msg, true);
  }
}

/** "Hết giấy — <chi tiết app>" ; không mã → chi tiết hoặc câu mặc định. */
function thongDiep(ma: string | undefined, loiCuoi: string | undefined, macDinh: string): string {
  const chiTiet = loiCuoi?.trim();
  if (ma) return chiTiet ? `${nhanCua(ma)} — ${chiTiet}` : nhanCua(ma);
  return chiTiet || macDinh;
}
