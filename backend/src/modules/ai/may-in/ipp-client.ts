// SPDX-License-Identifier: AGPL-3.0-or-later
// IppClient — gửi gói IPP tới máy in qua HTTP POST (application/ipp).
//
// PHÂN LOẠI LỖI LÀ HỢP ĐỒNG QUAN TRỌNG NHẤT của file này (luật A3 — chống
// in đôi, cùng họ với chống đơn trùng tool-ghi Odoo):
//   - LoiIpp guiDuoc=false: CHƯA tới được máy in (connection refused, DNS…)
//     → hàng đợi retry thoải mái.
//   - LoiIpp guiDuoc=true : máy in ĐÃ trả lời và từ chối (HTTP lỗi, IPP status
//     lỗi) → job không được nhận, retry cũng an toàn.
//   - LoiKhongRo          : đã nối được mà không thấy trả lời (timeout giữa
//     chừng) — máy in CÓ THỂ đã nhận job. CẤM retry mù; hàng đợi phải chuyển
//     trạng thái khong_ro chờ người quyết.
import {
  giaiMaPhanHoi,
  maHoaGetJobAttributes,
  maHoaPrintJob,
  type PhanHoiIpp,
} from './giao-thuc-ipp.js';

export interface IppClientConfig {
  /** vd ipp://192.168.1.50:631/ipp/print — giữ dạng ipp:// trong gói IPP. */
  uri: string;
  /** Trần chờ một round-trip. PDF hoá đơn ~200KB, LAN thì 1-2s là xong. */
  timeoutMs?: number;
  /** Tên hiện ở cột người gửi trên hàng đợi máy in. */
  nguoiGui?: string;
}

/** Máy in từ chối hoặc không tới được — biết rõ job KHÔNG được nhận. */
export class LoiIpp extends Error {
  constructor(
    message: string,
    /** true = request đã tới nơi và bị từ chối; false = chưa tới được. */
    readonly guiDuoc: boolean,
    readonly ippStatus?: number,
  ) {
    super(message);
    this.name = 'LoiIpp';
  }
}

/** Đã nối được mà không có trả lời — job CÓ THỂ đã vào máy in. Cấm retry mù. */
export class LoiKhongRo extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoiKhongRo';
  }
}

/** ipp://host:631/duong-dan → http://host:631/duong-dan (IPP chạy trên HTTP). */
function uriHttp(uri: string): string {
  return uri.replace(/^ipps:\/\//, 'https://').replace(/^ipp:\/\//, 'http://');
}

/** Mã lỗi hệ thống chắc chắn CHƯA gửi được gì. */
const CHUA_GUI = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'EADDRNOTAVAIL']);

export class IppClient {
  private demRequest = 0;

  constructor(private readonly cfg: IppClientConfig) {}

  /** Gửi PDF in trực tiếp (HP 4003 nhận application/pdf, không cần driver). */
  async inPdf(pdf: Buffer, tenJob: string): Promise<{ jobId: number | null; phanHoi: PhanHoiIpp }> {
    const goi = maHoaPrintJob({
      uri: this.cfg.uri,
      tenJob,
      nguoiGui: this.cfg.nguoiGui ?? 'zalocrm',
      requestId: this.requestId(),
      pdf,
    });
    const phanHoi = await this.goi(goi);
    const jobId = typeof phanHoi.thuocTinh['job-id'] === 'number' ? phanHoi.thuocTinh['job-id'] : null;
    return { jobId, phanHoi };
  }

  /** Hỏi trạng thái job đã gửi — bước BẮT BUỘC trước khi nghĩ tới in lại. */
  async traTrangThaiJob(jobId: number): Promise<{ jobState: number | null; phanHoi: PhanHoiIpp }> {
    const goi = maHoaGetJobAttributes({ uri: this.cfg.uri, jobId, requestId: this.requestId() });
    const phanHoi = await this.goi(goi);
    const jobState = typeof phanHoi.thuocTinh['job-state'] === 'number' ? phanHoi.thuocTinh['job-state'] : null;
    return { jobState, phanHoi };
  }

  private requestId(): number {
    // request-id IPP phải > 0; quay vòng là đủ vì chỉ so trong một kết nối.
    this.demRequest = (this.demRequest % 0x7ffffffe) + 1;
    return this.demRequest;
  }

  private async goi(goi: Buffer): Promise<PhanHoiIpp> {
    let res: Response;
    try {
      res = await fetch(uriHttp(this.cfg.uri), {
        method: 'POST',
        headers: { 'content-type': 'application/ipp' },
        body: new Uint8Array(goi),
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 15_000),
      });
    } catch (err) {
      // Node bọc lỗi socket trong TypeError('fetch failed') với cause là lỗi
      // đơn HOẶC AggregateError (thử cả IPv4 lẫn IPv6). Vét mọi mã trong đó.
      const cause = (err as { cause?: unknown })?.cause;
      const cacMa = [
        (cause as { code?: string })?.code,
        ...(((cause as { errors?: Array<{ code?: string }> })?.errors ?? []).map((e) => e?.code)),
      ].filter((c): c is string => typeof c === 'string');
      const maChuaGui = cacMa.find((c) => CHUA_GUI.has(c));
      if (maChuaGui) {
        throw new LoiIpp(`Không tới được máy in (${maChuaGui}) — chưa gửi gì`, false);
      }
      // Timeout/đứt giữa chừng: KHÔNG biết máy in đã nhận chưa.
      throw new LoiKhongRo(
        `Không thấy máy in trả lời (${(err as Error).name ?? 'lỗi'}) — job có thể ĐÃ vào máy in, không được gửi lại mù`,
      );
    }

    if (!res.ok) {
      throw new LoiIpp(`Máy in trả HTTP ${res.status}`, true);
    }
    const phanHoi = giaiMaPhanHoi(Buffer.from(await res.arrayBuffer()));
    if (!phanHoi.thanhCong) {
      throw new LoiIpp(
        `Máy in từ chối: IPP status 0x${phanHoi.status.toString(16).padStart(4, '0')}`,
        true,
        phanHoi.status,
      );
    }
    return phanHoi;
  }
}
