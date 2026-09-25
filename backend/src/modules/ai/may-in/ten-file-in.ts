// SPDX-License-Identifier: AGPL-3.0-or-later
// Tên file PDF khi in hoá đơn — dựng ở BACKEND, gửi xuống app PC trong field
// `name` của job ({id, name, pdfBase64, paperSize, tray, copies}).
//
// Mẫu (chủ chốt 24/09):  AI-INV_2026_030045-<Ten_Khach_khong_dau>-<jobId>.pdf
//   - "AI-"            : đánh dấu bản in do bot xếp, phân biệt với bản NV in tay.
//   - số hoá đơn       : "INV/2026/030045" → "INV_2026_030045" (bỏ "/").
//   - tên khách        : bỏ dấu tiếng Việt, mọi khoảng trắng/ký tự lạ → "_".
//   - jobId            : GIỮ NGUYÊN ở cuối — app PC nhận ra job trong hàng đợi
//                        in Windows bằng cách tìm DocumentName CHỨA jobId
//                        (print-agent spooler.rs `tim_job`). Bỏ jobId khỏi tên
//                        là app không xác nhận được "đã in", job treo khong_ro.
//
// VÌ SAO dựng ở backend chứ không ở app: backend có sẵn phiên Odoo để đọc tên
// khách, và dùng được String.normalize('NFD') — app Rust chỉ còn việc lọc
// ký tự cấm của Windows (phòng thủ) rồi dùng nguyên tên.

/** Tên khách khi không đọc được từ Odoo — vẫn giữ đủ 4 phần của mẫu. */
export const TEN_KHACH_KHONG_RO = 'Khong_ro';

/** Trần độ dài phần tên khách — đường dẫn tạm Windows + token trong jobId đã dài. */
export const TEN_KHACH_TOI_DA = 60;

/**
 * Bỏ dấu tiếng Việt: "Anh Lộc Beco Thanh Hoá" → "Anh Loc Beco Thanh Hoa".
 * NFD tách dấu thành ký tự kết hợp (U+0300–U+036F) rồi bỏ đi; "đ/Đ" KHÔNG
 * tách được bằng NFD (là chữ riêng) nên thay tay.
 */
export function boDau(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Chuỗi an toàn làm một đoạn của tên file: chỉ còn A–Z a–z 0–9 và "_".
 * Mỗi cụm ký tự khác (khoảng trắng, "/", "-", ",", ngoặc…) gộp thành MỘT "_",
 * bỏ "_" ở hai đầu. KHÔNG giữ "-" vì "-" là dấu ngăn giữa các phần của mẫu.
 */
export function doanAnToan(s: string, toiDa?: number): string {
  let kq = boDau(s)
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (toiDa !== undefined && kq.length > toiDa) {
    kq = kq.slice(0, toiDa).replace(/_+$/g, '');
  }
  return kq;
}

/**
 * Phần tên KHÔNG có jobId: "AI-INV_2026_030045-Anh_Loc_Beco".
 * jobId do AgentClient sinh ngay lúc gửi nên được nối sau (xem `tenFileDayDu`).
 */
export function taoTenFileIn(p: { soHoaDon: string; tenKhach: string | null | undefined }): string {
  const so = doanAnToan(p.soHoaDon) || 'khong_so';
  const khach = doanAnToan(p.tenKhach ?? '', TEN_KHACH_TOI_DA) || TEN_KHACH_KHONG_RO;
  return `AI-${so}-${khach}`;
}

/** Tên file đủ: "<phần gốc>-<jobId>.pdf". */
export function tenFileDayDu(goc: string, jobId: string): string {
  return `${goc}-${jobId}.pdf`;
}

/**
 * Model Odoo của bản ghi đang in, suy từ tên mẫu in (report_name) — để đọc
 * `partner_id` đúng bảng. Hermes luôn xếp mẫu hoá đơn (account.move); đường
 * TS cũ có thể xếp mẫu đơn bán. Mẫu lạ → null (in vẫn chạy, tên khách
 * "Khong_ro") — thà thiếu tên còn hơn đọc nhầm bảng ra tên người khác.
 */
export function modelCuaReport(report: string): 'account.move' | 'sale.order' | 'purchase.order' | null {
  if (report.includes('report_invoice')) return 'account.move';
  if (report.includes('report_saleorder')) return 'sale.order';
  if (report.includes('report_purchaseorder')) return 'purchase.order';
  return null;
}
