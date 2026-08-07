// SPDX-License-Identifier: AGPL-3.0-or-later
// PHÁT HIỆN BỰC TỨC / CHỬI — khách khó chịu thì NGƯỜI xử tốt hơn bot.
//
// Bug gốc 06/08: "mẹ mày. Cả đi" → bot lấy "Cả" (viết hoa) tra thành tên sản
// phẩm. Vừa lố bịch vừa đổ thêm dầu vào lửa. Học Chatwoot (07/08): tin có dấu
// hiệu bực/chửi → KHÔNG cố tra cứu, báo nhân viên vào xử — người xoa dịu được,
// bot thì càng máy móc càng chọc giận.
//
// KHÔNG chặn cứng bằng danh sách chửi dài (mong manh, dễ nhầm). Chỉ bắt các
// cụm CHỬI/BỰC RÕ RÀNG — nghi ngờ thì để model xử bình thường, thà bỏ sót một
// câu bực còn hơn báo nhân viên oan cho mỗi câu hơi gắt.

/** Bỏ dấu để bắt cả khi gõ không dấu. */
function boDau(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
}

/**
 * Cụm chửi / bực RÕ RÀNG. Mỗi cụm đều là lời công kích hoặc bực bội thẳng,
 * không phải câu hơi gắt bình thường ("sao lâu thế" KHÔNG tính).
 */
const CUM_BUC = [
  // chửi trực diện
  'me may', 'me mi', 'dm', 'dcm', 'dkm', 'vcl', 'vl', 'cc', 'ngu vl',
  'do ngu', 'thang ngu', 'con ngu', 'ngu the', 'ngu vai', 'oc cho',
  'cho chet', 'im mom', 'cam mom', 'cut', 'lon', 'buoi', 'dai',
  // bực bội / mất kiên nhẫn nặng
  'chan qua', 'buc minh', 'tuc qua', 'lam an kieu gi', 'vo dung',
  'chang ra gi', 'that vong', 'te hai', 'nhu cc', 'nhu shit',
];

/**
 * Tin này có dấu hiệu bực tức / chửi không?
 *
 * Bắt theo RANH GIỚI TỪ để "vl" không khớp giữa "level", "cc" không khớp giữa
 * "success" — cùng bài học tag @bot (03/08).
 */
export function laBucTuc(noiDung: string): boolean {
  const t = ` ${boDau(String(noiDung ?? '')).replace(/[^a-z0-9\s]/g, ' ')} `;
  return CUM_BUC.some((c) => t.includes(` ${c} `));
}

/**
 * Tin này có phải lời XÁC NHẬN cho việc bot vừa hỏi không? ("đúng", "đúng rồi",
 * "ok", "ừ", "chốt", "làm đi", "cập nhật đi"…).
 *
 * Bug thật 07/08 (S13804): nhân viên đáp "đúng rồi" nhiều lần, mỗi lượt bị guard
 * `coTinKhachMoiHon` coi là "có tin mới hơn → bỏ" nên KHÔNG lượt nào chạy trọn,
 * bot cứ hỏi lại vô tận, đơn không được sửa. Tin xác nhận là tín hiệu QUYẾT
 * ĐỊNH — phải xử ngay, KHÔNG được gộp/bỏ như tin tán gẫu.
 *
 * Chỉ bắt câu NGẮN, gọn (≤6 từ) để không nhầm câu dài có chứa "ok" ở giữa.
 */
const CUM_XAC_NHAN = [
  'dung', 'dung roi', 'dung vay', 'chuan', 'chuan roi', 'ok', 'oke', 'okey',
  'u', 'um', 'uh', 'da', 'vang', 'chot', 'chot don', 'lam di', 'tao di',
  'tao don di', 'cap nhat di', 'sua di', 'gui di', 'dong y', 'phai', 'yes', 'y',
];
export function laXacNhanNgan(noiDung: string): boolean {
  const raw = boDau(String(noiDung ?? '')).replace(/[^a-z0-9\s]/g, ' ').trim();
  if (!raw) return false;
  if (raw.split(/\s+/).length > 6) return false; // câu dài không coi là xác nhận thuần
  const t = ` ${raw} `;
  return CUM_XAC_NHAN.some((c) => t.includes(` ${c} `));
}
