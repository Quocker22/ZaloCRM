// SPDX-License-Identifier: AGPL-3.0-or-later
// Intent router (deterministic, hàm thuần). Phân loại tin khách TRƯỚC khi gọi LLM,
// để (1) chặn cứng câu nội bộ ở code (không tốn token, không rủi ro model bịa),
// (2) inject "hint" ép LLM trả lời đúng kiểu cho từng intent. Lý do: model nhỏ dễ
// trượt prompt dài — đẩy quyết định quan trọng ra code (như budget gate của scraper).

export type Intent =
  | 'internal'      // hỏi nội bộ (doanh thu, giá vốn, nhà cung cấp...) → chặn cứng
  | 'large_order'   // đơn rất lớn → handoff sale
  | 'order'         // ý định chốt số lượng cụ thể
  | 'discount'      // hỏi giảm giá/chiết khấu
  | 'price'         // hỏi giá
  | 'stock'         // hỏi còn hàng/tồn
  | 'general'       // bán chạy/phổ biến/có dòng nào
  | 'normal';       // còn lại (tư vấn thường / mơ hồ)

const INTERNAL_KW = [
  'giá vốn', 'giá nhập', 'giá gốc', 'giá sỉ nội bộ', 'lãi bao nhiêu', 'lời bao nhiêu',
  'biên lợi nhuận', 'lợi nhuận', 'doanh thu', 'doanh số', 'nhà cung cấp', 'nguồn hàng',
  'nhập ở đâu', 'nhập hàng ở', 'tồn kho tổng', 'số liệu bán', 'dữ liệu khách', 'kpi',
  'chính sách nội bộ', 'bao nhiêu nhân viên', 'lương',
];
const LARGE_ORDER_KW = [
  '1 triệu', 'một triệu', 'triệu bóng', 'triệu cái', 'lấy sỉ', 'mua sỉ', 'số lượng lớn',
  'số lượng nhiều', 'cả container', 'nguyên lô', 'đại lý', 'phân phối',
];
const DISCOUNT_KW = ['giảm giá', 'giảm không', 'chiết khấu', 'bớt', 'giá tốt', 'giá sỉ', 'rẻ hơn'];
const PRICE_KW = ['giá nhiêu', 'giá bao nhiêu', 'bao nhiêu tiền', 'bao nhiêu một', 'bao nhiêu 1', 'nhiêu tiền', 'giá sao', 'giá thế nào', 'mấy tiền'];
const STOCK_KW = ['còn không', 'còn hàng', 'còn hàng không', 'có sẵn', 'tồn bao nhiêu', 'còn bao nhiêu', 'có hàng'];
const ORDER_KW = ['lấy ', 'mua ', 'đặt hàng', 'chốt đơn', 'đặt mua', 'order'];
const GENERAL_KW = ['bán chạy', 'phổ biến', 'có những dòng', 'có dòng nào', 'loại nào nhiều', 'mẫu nào', 'có gì'];
const ORDER_QTY = /\b\d+\s*(cuộn|cái|m\b|mét|bộ|cây|thanh|hộp|thùng|bóng)/i;

function hasKw(text: string, kws: string[]): boolean {
  return kws.some((k) => text.includes(k));
}

/**
 * Classify customer message into a sales intent. Order matters: more specific /
 * higher-priority intents win (internal block first, then large order, etc.).
 */
export function classifyIntent(message: string): Intent {
  const t = message.toLowerCase().trim();
  if (hasKw(t, INTERNAL_KW)) return 'internal';
  // Discount trước large_order: "lấy số lượng nhiều CÓ GIẢM KHÔNG" trọng tâm là hỏi giảm giá
  // (trả lời cụ thể hơn), dù vẫn dẫn tới chuyển sale như large_order.
  if (hasKw(t, DISCOUNT_KW)) return 'discount';
  if (hasKw(t, LARGE_ORDER_KW)) return 'large_order';
  // order intent: từ khóa mua + có số lượng (tránh bắt nhầm "mua gì để decor")
  if (hasKw(t, ORDER_KW) && (ORDER_QTY.test(t) || /\bchốt|đặt hàng|order\b/.test(t))) return 'order';
  if (hasKw(t, PRICE_KW)) return 'price';
  if (hasKw(t, STOCK_KW)) return 'stock';
  if (hasKw(t, GENERAL_KW)) return 'general';
  return 'normal';
}

// Câu từ chối nội bộ — trả thẳng ở code, KHÔNG gọi LLM (an toàn tuyệt đối, 0 token).
export const INTERNAL_REPLY =
  'Dạ phần này là thông tin nội bộ nên em không cung cấp được ạ. Anh/chị cần tư vấn đèn LED hay kiểm tra mã hàng nào không ạ?';

/**
 * Hint chèn vào đầu prompt để ép LLM trả lời đúng kiểu cho intent đã phát hiện.
 * Trả '' cho 'normal' (không ép). 'internal' không dùng hint (đã chặn ở code).
 */
export function intentHint(intent: Intent): string {
  switch (intent) {
    case 'large_order':
      return 'INTENT: ĐƠN LỚN. BẮT BUỘC: chốt lead + chuyển sale, đặt needs_human=true. KHÔNG hỏi "mua làm gì".';
    case 'order':
      return 'INTENT: CHỐT ĐƠN. BẮT BUỘC: xác nhận sản phẩm + số lượng khách nói, xin khu vực giao hoặc chuyển sale. KHÔNG hỏi lại nhu cầu trang trí.';
    case 'discount':
      return 'INTENT: HỎI GIẢM GIÁ. BẮT BUỘC: nói giảm giá tùy số lượng (chưa có mức cố định), hỏi số lượng để chuyển sale. KHÔNG bịa mức giảm.';
    case 'price':
      return 'INTENT: HỎI GIÁ. BẮT BUỘC: câu đầu PHẢI báo giá sản phẩm lấy từ TÀI LIỆU nếu có. Nếu tài liệu ghi "Giá bán: chưa có" thì nói cần nhân viên kiểm tra giá. KHÔNG né để đi hỏi nhu cầu.';
    case 'stock':
      return 'INTENT: HỎI TỒN. BẮT BUỘC: câu đầu PHẢI nói còn/hết + số tồn từ TÀI LIỆU nếu có.';
    case 'general':
      return 'INTENT: HỎI CHUNG/BÁN CHẠY. BẮT BUỘC: dùng dữ liệu nhóm ngành + thống kê trong TÀI LIỆU. KHÔNG nói "bán chạy nhất". Nói "nhiều mẫu/phổ biến nhất là nhóm...".';
    default:
      return '';
  }
}
