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
