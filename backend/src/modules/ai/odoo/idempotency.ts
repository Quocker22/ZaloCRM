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
 * HÀNG ĐỢI THEO KHOÁ — hai lượt CHỒNG NHAU cùng một khoá phải đi NỐI ĐUÔI.
 *
 * ── VÌ SAO CẦN: CA THẬT 11:15-11:16 ngày 12/08/2026, HAI ĐƠN THẬT vào Odoo ──
 *   11:14:11  NV : "@bot lên đơn cho anh Vấn 10 cái Led F5 ... giá 100k nhé"
 *   11:14:19  Bot: "Anh/chị báo giá 100.000đ cho 'Led F5...' — xác nhận giúp em"
 *   11:15:52  NV : "đúng rồi"                    ← tin 1
 *   11:16:00  NV : "@Tiểu Mã Nelia đúng rồi"     ← tin 2, cách 8 GIÂY, cùng ý
 *   11:16:13  Bot: "Đã lên đơn nháp S13834 ..."  ← đơn 1 (id 26751)
 *   11:16:24  Bot: "Đã lên đơn nháp S13835 ..."  ← đơn 2 (id 26752), TRÙNG HẲN
 * Cùng khách KH000027, cùng 10 × Led F5, cùng 1.000.000đ. Đây không chỉ là bot
 * nói hai lần — là GHI DỮ LIỆU SAI vào sổ sách, phải dò và xoá bằng tay.
 *
 * Khoá chống trùng của các tool ghi là "TRA `client_order_ref`/`origin` rồi
 * CREATE" — HAI BƯỚC RỜI NHAU. Lượt 1 mất 21 giây mới xong, lượt 2 vào lúc giây
 * thứ 8: cả hai cùng tra thấy "chưa có đơn nào", rồi cả hai cùng create.
 * Kiểm-rồi-ghi không nguyên tử thì thêm bao nhiêu lớp kiểm cũng vô nghĩa dưới
 * hai lượt chồng nhau.
 *
 * Nối đuôi theo khoá thì lượt 2 chỉ chạy SAU khi lượt 1 ghi xong, nên bước tra
 * của nó THẤY đơn vừa tạo và trả `da_ton_tai` — không tạo đơn thứ hai.
 *
 * TRONG TIẾN TRÌNH là đủ và đúng chỗ: hai tin của một hội thoại Zalo luôn do
 * cùng một tiến trình nhận (một kết nối zca-js).
 *
 * ĐÂY LÀ HÀNG RÀO CUỐI, KHÔNG PHẢI HÀNG RÀO DUY NHẤT — và nó chỉ có tác dụng
 * khi hai lượt sinh ra CÙNG một khoá. Xem `PhienGom.viecId`: khoá phải nhận
 * diện VIỆC (phiên đang gom), không phải TIN vừa gõ. Trước bản vá 12/08, `seq`
 * lấy từ messageId nên hai tin ra hai khoá khác nhau và hàng rào này vô hiệu.
 *
 * Các lớp trên nó (mỗi lớp một bài toán, đừng gộp):
 *   - khoa-viec.ts    : băm theo NỘI DUNG CÂU. Mỏng manh — "đúng rồi" và
 *                       "[Trả lời tin: ...] đúng rồi" băm ra hai mã khác nhau.
 *   - aiSuggestion    : cùng MỘT messageId được xử lý lại.
 *   - coTinKhachMoiHon: bỏ lượt khi có tin mới hơn (nhưng MIỄN TRỪ câu xác nhận
 *                       ngắn — bug S13804 07/08, đừng gỡ miễn trừ đó).
 */
const dangGhi = new Map<string, Promise<void>>();

export async function noiDuoiTheoKhoa<T>(khoa: string, viec: () => Promise<T>): Promise<T> {
  // Xếp vào ĐUÔI hàng đợi của chính khoá này. Truyền `viec` cho cả hai nhánh
  // của `.then` để một lượt lỗi không nuốt luôn lượt xếp sau.
  const truoc = dangGhi.get(khoa) ?? Promise.resolve();
  const luot = truoc.then(viec, viec);
  // Mắt xích mới cho người đến sau — nuốt lỗi để chuỗi không đứt.
  const matXich = luot.then(() => {}, () => {});
  dangGhi.set(khoa, matXich);
  // Dọn khi mình là mắt xích CUỐI (bản đồ này sống suốt đời tiến trình). Còn ai
  // xếp sau thì `dangGhi` đã trỏ vào mắt xích của họ — xoá lúc đó là mở toang
  // khoá cho lượt đang chờ.
  void matXich.then(() => {
    if (dangGhi.get(khoa) === matXich) dangGhi.delete(khoa);
  });
  return luot;
}

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
