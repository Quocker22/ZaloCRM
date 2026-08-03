// SPDX-License-Identifier: AGPL-3.0-or-later
// Khoá chống trùng đơn (idempotency key).
//
// VÌ SAO BẮT BUỘC: vòng lặp agentic có retry. LLM có thể gọi lại tool sau khi
// timeout, mạng chập chờn có thể khiến request đi 2 lần, và bản thân model đôi
// khi gọi trùng trong cùng một lượt. Không có khoá = 2 đơn cho 1 khách.
// Đây là lỗi tiền bạc thật, không phải lỗi kỹ thuật cho vui.
//
// Cách hiện thực: nhét khoá vào `client_order_ref` của sale.order rồi tra
// trước khi tạo. Odoo không có cơ chế idempotency sẵn, nhưng field này
// searchable nên đủ dùng.
//
// CẠM BẪY ĐÃ KHẢO SÁT: sale_order.py:115 TỰ ĐIỀN client_order_ref từ sequence
// `incokit.dh.ref` nếu để trống. Nên phải LUÔN truyền vào rõ ràng — để trống là
// mất chốt chặn mà không có cảnh báo nào.

/** Tiền tố nhận diện đơn do bot Zalo tạo. Cũng để lọc/thống kê về sau. */
export const IDEMPOTENCY_PREFIX = 'zalo';

/**
 * Sinh khoá cho một lần chốt đơn.
 *
 * Định dạng: `zalo:{conversationId}:{seq}`
 *
 * @param conversationId id hội thoại Zalo — cùng khách, cùng luồng chat
 * @param seq            số thứ tự lần chốt trong hội thoại đó. Khách chốt đơn
 *                       thứ 2 trong cùng cuộc chat thì seq tăng, tạo khoá mới.
 *
 * Không dùng timestamp hay random: retry phải sinh RA CÙNG một khoá thì mới
 * chặn được trùng. Khoá phải suy ra được từ ngữ cảnh, không phải sinh ngẫu nhiên.
 */
export function sinhKhoaDon(conversationId: string, seq: number): string {
  const conv = String(conversationId ?? '').trim();
  if (!conv) throw new Error('Thiếu conversationId khi sinh khoá đơn');
  const n = Number.isInteger(seq) && seq >= 0 ? seq : 0;
  return `${IDEMPOTENCY_PREFIX}:${conv}:${n}`;
}

/** Khoá này có phải do bot sinh không (dùng để lọc/thống kê). */
export function laKhoaBot(ref: unknown): boolean {
  return typeof ref === 'string' && ref.startsWith(`${IDEMPOTENCY_PREFIX}:`);
}

/** Tách ngược khoá ra conversationId + seq. Trả null nếu không phải khoá bot. */
export function tachKhoaDon(ref: string): { conversationId: string; seq: number } | null {
  if (!laKhoaBot(ref)) return null;
  // conversationId có thể chứa dấu ':' nên tách từ PHẢI sang.
  const cuoi = ref.lastIndexOf(':');
  const dau = IDEMPOTENCY_PREFIX.length + 1;
  if (cuoi <= dau) return null;
  const seq = Number(ref.slice(cuoi + 1));
  if (!Number.isInteger(seq)) return null;
  return { conversationId: ref.slice(dau, cuoi), seq };
}
