// SPDX-License-Identifier: AGPL-3.0-or-later
// Hàng rào dùng chung cho 3 tool Odoo tổng quát.
// Spec: docs/superpowers/specs/2026-08-10-tool-odoo-tong-quat-design.md
//
// VÌ SAO PHANH NẰM Ở CODE, KHÔNG PHẢI PROMPT: chỉ trong tuần này bot đã bịa id
// khách (đơn S13810 sai người), lặp câu hỏi vô tận, và kẹt phiên 5 lệnh liền.
// Với quyền ĐỌC thì mấy lỗi đó gây phiền; với quyền GHI tự do chúng thành mất
// dữ liệu thật, không hoàn tác được (Odoo không có undo).
//
// Anh Quốc chốt 10/08: bot làm được mọi thao tác, CHỈ hai việc phải xin phép —
// xoá bất kỳ, và lệnh đụng hơn 20 bản ghi.

/** Lệnh đụng NHIỀU HƠN ngần này bản ghi phải xin xác nhận. */
export const NGUONG_HANG_LOAT = 20;

/**
 * Cột lộ giá vốn / biên lợi nhuận — khớp FORBIDDEN_FIELDS của tra-san-pham.ts.
 *
 * Tool cũ chặn bằng danh sách TRẮNG (chỉ cho đọc cột đã khai). Tool tổng quát
 * không dùng được cách đó vì mục đích của nó là đọc bảng nào cũng được — nên
 * đổi sang danh sách ĐEN + khớp mẫu, và chặn TRƯỚC khi gọi Odoo.
 */
const CAM = ['standard_price', 'cost', 'purchase_price', 'margin'];

export function laCotCam(ten: string): boolean {
  const t = ten.toLowerCase();
  return CAM.includes(t) || t.includes('cost') || t.includes('margin');
}

export function locCotCam(cot: string[]): { sach: string[]; cam: string[] } {
  const sach: string[] = [];
  const cam: string[] = [];
  for (const c of cot) (laCotCam(c) ? cam : sach).push(c);
  return { sach, cam };
}

export type QuyetDinh =
  | { chay: true }
  | { chay: false; lyDo: 'xoa' | 'hang_loat'; soBanGhi: number };

/**
 * Có được chạy lệnh ghi này ngay không, hay phải xin nhân viên xác nhận.
 *
 * `xacNhan` là lượt thứ hai — nhân viên đã đọc "sẽ xoá 47 bản ghi" và gật.
 */
export function quyetDinhPhanh(input: {
  viec: string;
  nut?: string;
  soBanGhi: number;
  xacNhan?: boolean;
}): QuyetDinh {
  if (input.xacNhan) return { chay: true };
  // Xoá LUÔN phải hỏi, kể cả 1 bản ghi: Odoo không có thùng rác.
  if (input.nut === 'unlink') return { chay: false, lyDo: 'xoa', soBanGhi: input.soBanGhi };
  if (input.soBanGhi > NGUONG_HANG_LOAT) {
    return { chay: false, lyDo: 'hang_loat', soBanGhi: input.soBanGhi };
  }
  return { chay: true };
}
