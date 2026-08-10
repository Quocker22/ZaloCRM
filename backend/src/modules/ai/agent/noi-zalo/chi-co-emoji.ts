// SPDX-License-Identifier: AGPL-3.0-or-later
// Tách khỏi luong-media.ts (10/08) để CẮT IMPORT VÒNG TRÒN.
//
// Khi luong-media bắt đầu đọc ảnh, nó phải gọi luong-nhan-vien và luong-khach
// để chuyển tiếp nội dung đọc được. Mà luong-khach vốn đã import chiCoEmoji từ
// luong-media → vòng tròn. ESM chịu được nhưng dễ sinh `undefined` tuỳ thứ tự
// nạp module, và vỡ lúc chạy thật chứ không phải lúc test.
//
// Hàm này thuần, không phụ thuộc gì — để riêng thì cả hai bên cùng import
// xuống mà không ai import ngược lên.

/**
 * Text CHỈ còn emoji/ký tự trang trí sau khi bỏ khoảng trắng + dấu câu?
 *
 * "👍", "👌👌", "😀 !!" → true (bỏ qua, không gọi LLM).
 * "ok 👍", "10 cái"     → false (có chữ/số thật, xử lý bình thường).
 */
export function chiCoEmoji(text: string): boolean {
  const t = String(text ?? '').trim();
  if (!t) return true;
  // Bỏ mọi thứ KHÔNG phải chữ hoặc số (mọi bảng chữ cái Unicode) — còn lại gì
  // thì đó là nội dung thật.
  return !/[\p{L}\p{N}]/u.test(t);
}

