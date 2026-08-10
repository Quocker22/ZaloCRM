// SPDX-License-Identifier: AGPL-3.0-or-later
// SẢN PHẨM KỸ THUẬT — dòng trong đơn KHÔNG phải hàng thật (VAT, phí ship,
// chiết khấu). Lọc khỏi báo cáo SỐ LƯỢNG, GIỮ trong báo cáo TIỀN.
//
// PHÁT HIỆN THẬT 10/08 trên Odoo prod: kế toán ghi thuế bằng cách tạo một SP
// giả `[SP000070] VAT 8%` đơn giá 1đ rồi đặt SỐ LƯỢNG = SỐ TIỀN thuế
// (qty=43.968.000 × 1đ). Cách này ra ĐÚNG tiền — không phải dữ liệu bẩn, mà là
// mẹo kế toán cố ý. Báo cáo theo tiền vì vậy hoàn toàn chính xác.
//
// Nhưng báo cáo theo SỐ LƯỢNG thì hỏng nặng. Đo kỳ 08/2026 (507 dòng):
//   số lượng kể cả SP kỹ thuật: 131.800.532
//   số lượng hàng THẬT        :     488.672   ← sai 270 lần
//   rác từ 36 dòng VAT/phí ship: 131.311.860 "cái" (thật ra là TIỀN)
//
// VÌ SAO LỌC THEO TÊN, KHÔNG THEO GIÁ: thử lọc "giá ≤ 1đ" thì bắt nhầm 40 sản
// phẩm THẬT chưa nhập giá (Led 2 bóng 3609, Nguồn YL 24V400W Đổ Keo…). Mất
// hàng khỏi báo cáo còn tệ hơn thừa rác — thừa thì nhìn ra ngay, thiếu thì
// không ai biết.

/**
 * Cụm từ nhận diện dòng kỹ thuật, so trên tên đã bỏ dấu.
 *
 * Đo thật trên prod: 7 SP kỹ thuật đang dùng là "VAT 8%", "VAT 5%", "vat",
 * "VAT", "Phí vận chuyển" (3 biến thể), và dự phòng "chiết khấu"/"thuế".
 *
 * `vat` để riêng và so theo TỪ TRỌN VẸN: nhúng vào giữa chữ thì khớp nhầm vô
 * số tên hàng ("nvateco", "vattu"…).
 */
const CUM_KY_THUAT = [
  'phi van chuyen',
  'phi ship',
  'chiet khau',
  'thue gtgt',
  'thue vat',
];

/** Bỏ dấu để so khớp bất kể nhân viên gõ có dấu hay không. */
function boDau(s: string): string {
  return String(s ?? '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
}

/**
 * Tên sản phẩm này là dòng KỸ THUẬT (không phải hàng thật) chứ?
 *
 * Thà bỏ sót còn hơn lọc nhầm: tên rỗng/lạ → trả `false` (giữ lại). Thừa một
 * dòng rác thì nhìn ra ngay; thiếu một mặt hàng thì không ai phát hiện.
 */
export function laSanPhamKyThuat(ten: string | null | undefined): boolean {
  const t = boDau(ten ?? '').trim();
  if (!t) return false;

  // "vat"/"thue" đứng như một TỪ RIÊNG (kể cả kèm % hay mã "[SP000070] VAT 8%").
  if (/(?:^|[^a-z])(?:vat|thue)(?:[^a-z]|$)/.test(t)) return true;

  return CUM_KY_THUAT.some((c) => t.includes(c));
}

/**
 * Lọc dòng kỹ thuật khi và CHỈ KHI báo cáo đo số lượng đơn thuần.
 *
 * `do` ghép nhiều chỉ tiêu ("so_luong,tong_tien") thì GIỮ NGUYÊN: cột tiền vẫn
 * phải đủ, bỏ dòng VAT đi là báo thiếu doanh thu — đo thật 131.521.857đ tiền
 * thuế trong kỳ 08/2026.
 */
export function locChoSoLuong<T>(
  dong: readonly T[],
  doChiTieu: string,
  layTen: (d: T) => string,
): T[] {
  const chiTieu = String(doChiTieu ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const chiDoSoLuong = chiTieu.length > 0 && chiTieu.every((c) => c === 'so_luong');
  if (!chiDoSoLuong) return [...dong];
  return dong.filter((d) => !laSanPhamKyThuat(layTen(d)));
}
