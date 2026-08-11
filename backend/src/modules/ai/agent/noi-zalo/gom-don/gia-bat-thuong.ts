// SPDX-License-Identifier: AGPL-3.0-or-later
// Hàng rào GIÁ BẤT THƯỜNG — chặn con số model nhét nhầm ô, KHÔNG chặn việc
// nhân viên tự quyết giá.
//
// ── VÌ SAO CÓ FILE NÀY ────────────────────────────────────────────────────
// Bug thật nhóm Test-AI 10:09:33 ngày 11/08/2026. Nhân viên nhắn "card thu
// triết khấu 8%". Model đọc "8%" rồi nhét số 8 vào ô ĐƠN GIÁ, bot trả:
//
//   100 × Card thu BX-V7512 (cái) = 800đ (giá anh/chị báo 8đ, hệ thống 230.000đ)
//   Tổng: … Em chốt lên đơn nhé?
//
// tra_san_pham trả đúng 230.000đ/Cái ở CẢ 4 LẦN gọi (đã soi log) — số 8 hoàn
// toàn do model bịa. Đơn 46 triệu tụt còn 800đ. Bot in cả hai con số cạnh
// nhau, lệch 28.750 lần, rồi vẫn bình thản rủ chốt. Nhân viên gõ "ok" một
// cái là đơn sai nằm trong hệ thống.
//
// ── VÌ SAO KHÔNG CHẶN CỨNG MỌI CHÊNH LỆCH ─────────────────────────────────
// Anh Quốc chốt 10/08: giá NHÂN VIÊN báo THẮNG giá hệ thống — họ đã chốt với
// khách rồi, giá Odoo có thể cũ. Đó cũng là đường để SP chưa nhập giá vẫn lên
// đơn được. Chặn mọi chênh lệch là phá đúng luật nghiệp vụ vừa mở.
// Cái cần chặn chỉ là chênh lệch VÔ LÝ — mức mà con người không bao giờ gõ.

/**
 * Giá dưới mức này coi là "chưa có giá" (placeholder), khớp NGUONG_GIA_AO của
 * tra-san-pham. Không nhân bản hằng số ở đây để tránh lệch định nghĩa: import
 * thẳng từ nguồn.
 */
import { NGUONG_GIA_AO } from '../../../odoo/tools/tra-san-pham.js';

/**
 * Biên tỷ lệ (giá NV báo / giá hệ thống) còn coi là NGƯỜI THẬT quyết.
 *
 * ── SỐ ĐO THẬT trên Odoo prod, 11/08/2026 ───────────────────────────────
 * Mẫu: 5.781 dòng sale.order.line của 2026 có price_unit > 0 và sản phẩm có
 * giá niêm yết thật (>10đ). Tỷ lệ r = price_unit / list_price:
 *
 *   p0.01  0,133   p0.1  0,400   p1   0,608   p5   0,853
 *   p25    1,000   p50   1,000   p75  1,061   p90  1,210
 *   p95    1,353   p99   1,647   p99.9 2,333
 *   min    0,1333          max   200,0
 *
 * Đếm theo ngưỡng:
 *   r < 0,5  : 22 dòng (0,38%)      r > 2   : 10 dòng (0,17%)
 *   r < 0,34 :  1 dòng (0,017%)     r > 5   :  3 dòng (0,05%)
 *   r < 0,15 :  1 dòng (0,017%)     r > 10  :  2 dòng (0,035%)
 *   r < 0,1  :  0 dòng  ← KHÔNG CÓ  r > 20  :  2 dòng
 *
 * Đọc số này ra quyết định:
 *   - Dưới 0,1 lần: TRONG TOÀN BỘ 2026 KHÔNG MỘT DÒNG NÀO. Dòng thấp nhất
 *     từng có là r = 0,133 (dây trong suốt: ghi 300đ / niêm yết 2.250đ) —
 *     vẫn cách biên 0,1 một quãng an toàn.
 *   - Trên 10 lần: đúng 2 dòng, và cả hai là CÙNG một sản phẩm
 *     ("thanh 1m nhôm fi50", ghi 58-60k / niêm yết 300đ) — giá niêm yết cũ
 *     chưa cập nhật, không phải nhân viên tăng giá 200 lần.
 *
 * Ca bug 10:09:33 nằm ở r = 8 / 230.000 = 0,0000348 — thấp hơn dòng thấp
 * nhất từng ghi nhận khoảng 3.800 lần. Chọn biên 0,1 / 10 thì hàng rào này
 * KHÔNG chạm một dòng bán thật nào trong 5.781 dòng đo được, mà vẫn bắt gọn
 * ca thật lẫn kiểu gõ nhầm một-hai số 0.
 *
 * Cố ý để biên RỘNG (không siết về 0,3): việc của hàng rào là bắt số model
 * bịa, không phải phán xét nhân viên bán rẻ. Nghi ngờ thì cho qua — chặn
 * nhầm một đơn thật tốn lòng tin hơn nhiều so với hỏi lại một câu.
 */
export const TY_LE_SAN = 0.1;
export const TY_LE_TRAN = 10;

/**
 * Giá nhân viên báo có lệch VÔ LÝ so với giá hệ thống không?
 *
 * `false` khi không đủ cơ sở so sánh — nguyên tắc chung của hàng rào này là
 * im lặng cho qua chứ không chặn bừa:
 *   - hệ thống chưa có giá (≤ NGUONG_GIA_AO): lấy 1đ làm mẫu số thì giá thật
 *     nào cũng hoá "vô lý", phá đúng đường "SP chưa nhập giá vẫn lên đơn
 *     được" mở hôm 10/08.
 *   - nhân viên không báo giá: không có gì để đối chiếu.
 *   - số rác (NaN, âm): ô giá đã bị lamSachTrich lọc, tới đây là thừa — nhưng
 *     thừa còn hơn ném lỗi giữa luồng lên đơn.
 */
export function lechVoLy(giaNv: number | undefined, giaHeThong: number | undefined): boolean {
  const nv = Number(giaNv);
  const ht = Number(giaHeThong);
  if (!Number.isFinite(nv) || nv <= 0) return false;
  if (!Number.isFinite(ht) || ht <= NGUONG_GIA_AO) return false;
  const r = nv / ht;
  return r < TY_LE_SAN || r > TY_LE_TRAN;
}
